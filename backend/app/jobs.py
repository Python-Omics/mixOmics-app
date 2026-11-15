"""Cola serial y protocolo de archivos para los jobs de análisis.

La API no calcula: encola una especificación y un proceso hijo la ejecuta. El
protocolo entre ambos vive en archivos dentro de
``<DATA_DIR>/jobs/<job_id>/``:

* ``spec.json``: trabajo completo que se entrega al hijo por ``argv``;
* ``progress.json``: etapa actual, reescrita de forma atómica;
* ``result.json``: resultado serializable del análisis;
* ``error.json``: error estructurado si el trabajo falla;
* ``worker.log``: salida estándar y de error del proceso hijo.

La cola es **serial**: hay un solo proceso de cálculo activo. Así el pico de
memoria del trabajo no se multiplica y se respeta el techo de 4 GB de
RNF-R-3. Este módulo no importa ``pythomics`` ni ``rpy2``: el único proceso
que puede importar la biblioteca analítica es el worker hijo.
"""

from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.errors import ErrorCode, PythomicsError
from app.schemas import (
    ApiError,
    Dataset,
    ErrorEnvelope,
    Job,
    ModelRequest,
    ModelResult,
    Progress,
)

#: Formato estricto del identificador de un job.
JOB_ID_PATTERN = re.compile(r"^job_[0-9a-f]{12}$")

#: Prefijo de los identificadores de job.
JOB_ID_PREFIX = "job_"

#: Cantidad de hexadecimales del identificador.
JOB_ID_HEX_LENGTH = 12

#: Cantidad total de etapas que informa el progreso.
TOTAL_STAGES = 6

#: Nombres de los archivos del protocolo dentro del directorio del job.
SPEC_FILENAME = "spec.json"
PROGRESS_FILENAME = "progress.json"
RESULT_FILENAME = "result.json"
ERROR_FILENAME = "error.json"
LOG_FILENAME = "worker.log"


def new_job_id() -> str:
    """Genera un identificador de job nuevo."""
    return f"{JOB_ID_PREFIX}{uuid4().hex[:JOB_ID_HEX_LENGTH]}"


def write_json_atomic(path: Path, payload: Any) -> None:
    """Escribe un JSON de forma atómica.

    Primero se escribe un temporal en el mismo directorio y después se
    renombra con :func:`os.replace`. Un lector concurrente nunca observa un
    JSON a medio escribir.
    """
    temporal = path.with_name(f"{path.name}.{uuid4().hex[:8]}.tmp")
    try:
        temporal.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporal, path)
    except OSError:
        try:
            temporal.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def write_error(path: Path, error: ApiError) -> None:
    """Escribe un error en el sobre uniforme del protocolo."""
    write_json_atomic(
        path,
        ErrorEnvelope(error=error).model_dump(mode="json"),
    )


@dataclass(frozen=True, slots=True)
class JobPaths:
    """Rutas de los archivos que pertenecen a un job."""

    directory: Path
    spec: Path
    progress: Path
    result: Path
    error: Path
    log: Path

    @classmethod
    def for_job(cls, root: Path, job_id: str) -> "JobPaths":
        """Construye las rutas de un job después de validar su identificador."""
        directory = cls._validated_directory(root, job_id)
        return cls(
            directory=directory,
            spec=directory / SPEC_FILENAME,
            progress=directory / PROGRESS_FILENAME,
            result=directory / RESULT_FILENAME,
            error=directory / ERROR_FILENAME,
            log=directory / LOG_FILENAME,
        )

    @staticmethod
    def _validated_directory(root: Path, job_id: str) -> Path:
        """Valida el identificador antes de construir cualquier ruta."""
        if not job_id or not JOB_ID_PATTERN.match(job_id):
            raise PythomicsError(
                ErrorCode.E_JOB_NOT_FOUND,
                detail={"job_id": job_id},
            )
        return Path(root) / job_id


@dataclass(slots=True)
class _JobState:
    """Estado mutable de un job conocido por el gestor."""

    status: str
    process: subprocess.Popen[bytes] | None = None


class JobManager:
    """Gestiona la cola serial y el ciclo de vida de los procesos hijo."""

    def __init__(self, root: Path) -> None:
        """Crea el gestor y su hilo de atención de la cola.

        Parámetros:
            root: Directorio donde viven los jobs. Se crea si no existe.
        """
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._states: dict[str, _JobState] = {}
        self._lock = threading.RLock()
        self._stopping = False
        self._thread = threading.Thread(
            target=self._consume_queue,
            name="pythomics-job-worker",
            daemon=True,
        )
        self._thread.start()

    def create(self, dataset: Dataset, model: ModelRequest) -> str:
        """Crea la especificación de un job y lo encola.

        La receta completa viaja en el spec: el hijo no consulta la API ni
        necesita al proceso padre para saber qué bloques y qué alineación debe
        materializar.

        Devuelve:
            El identificador del job recién creado.
        """
        job_id = new_job_id()
        paths = JobPaths.for_job(self.root, job_id)
        paths.directory.mkdir(parents=True, exist_ok=False)

        target = model.target if model.target is not None else dataset.target
        alignment = (
            dataset.alignment.model_dump(mode="json")
            if dataset.alignment is not None
            else None
        )
        spec = {
            "job_id": job_id,
            "dataset_id": dataset.id,
            "blocks": [block.model_dump(mode="json") for block in dataset.blocks],
            "alignment": alignment,
            "target": target.model_dump(mode="json") if target is not None else None,
            "model": {
                "model_type": model.model_type,
                "n_components": model.n_components,
                "keepX": model.keepX,
                "design": model.design,
                "seed": model.seed,
            },
            "paths": {
                "spec": str(paths.spec),
                "progress": str(paths.progress),
                "result": str(paths.result),
                "error": str(paths.error),
                "log": str(paths.log),
            },
        }

        write_json_atomic(paths.spec, spec)
        write_json_atomic(
            paths.progress,
            Progress(stage="queued", index=0, total=TOTAL_STAGES).model_dump(
                mode="json"
            ),
        )
        paths.log.touch(exist_ok=True)

        with self._lock:
            self._states[job_id] = _JobState(status="queued")
        self._queue.put(job_id)
        return job_id

    def get(self, job_id: str) -> Job:
        """Devuelve el estado actual de un job.

        El estado terminal se combina con los archivos del directorio: el
        resultado y el error no se guardan únicamente en memoria.
        """
        paths = JobPaths.for_job(self.root, job_id)
        if not paths.directory.is_dir():
            raise PythomicsError(
                ErrorCode.E_JOB_NOT_FOUND,
                detail={"job_id": job_id},
            )

        with self._lock:
            state = self._states.get(job_id)
            status = state.status if state is not None else self._infer_status(paths)

        return Job(
            job_id=job_id,
            status=status,
            progress=self._read_progress(paths.progress),
            result=self._read_result(paths.result),
            error=self._read_error(paths.error),
        )

    def cancel(self, job_id: str) -> str:
        """Cancela un job y mata su proceso hijo si todavía está corriendo.

        La cancelación es idempotente: un job ya terminado conserva su estado
        final.
        """
        paths = JobPaths.for_job(self.root, job_id)
        if not paths.directory.is_dir():
            raise PythomicsError(
                ErrorCode.E_JOB_NOT_FOUND,
                detail={"job_id": job_id},
            )

        with self._lock:
            state = self._states.get(job_id)
            if state is None:
                state = _JobState(status=self._infer_status(paths))
                self._states[job_id] = state

            if state.status in {"completed", "failed", "cancelled"}:
                return state.status

            state.status = "cancelled"
            process = state.process

        if process is not None and process.poll() is None:
            try:
                process.kill()
            except OSError:
                # El proceso pudo terminar entre ``poll`` y ``kill``. El hilo
                # que lo supervisa conserva el estado terminal real.
                pass

        return "cancelled"

    def shutdown(self) -> None:
        """Detiene la cola y cancela el proceso activo.

        Se usa al cerrar la aplicación y al terminar una prueba, para no
        dejar procesos analíticos huérfanos.
        """
        with self._lock:
            if self._stopping:
                return
            self._stopping = True
            active_processes = [
                state.process
                for state in self._states.values()
                if state.process is not None
            ]
            for state in self._states.values():
                if state.status in {"queued", "running"}:
                    state.status = "cancelled"

        for process in active_processes:
            if process.poll() is None:
                try:
                    process.kill()
                except OSError:
                    pass

        self._queue.put(None)
        self._thread.join(timeout=5)

    def _consume_queue(self) -> None:
        """Atiende los jobs uno por uno mientras el gestor esté activo."""
        while True:
            job_id = self._queue.get()
            try:
                if job_id is None:
                    return
                self._run_job(job_id)
            finally:
                self._queue.task_done()

    def _run_job(self, job_id: str) -> None:
        """Ejecuta un job y actualiza su estado terminal."""
        paths = JobPaths.for_job(self.root, job_id)

        with self._lock:
            state = self._states.get(job_id)
            if state is None:
                state = _JobState(status="queued")
                self._states[job_id] = state
            if state.status != "queued":
                return
            state.status = "running"

        backend_dir = Path(__file__).resolve().parent.parent
        try:
            with paths.log.open("ab") as log:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "app.worker",
                        str(paths.spec),
                    ],
                    cwd=str(backend_dir),
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
        except OSError as exc:
            error = ApiError(
                code=ErrorCode.E_WORKER_CRASHED.value,
                message_key="errors.workerCrashed",
                detail={"reason": str(exc)},
            )
            try:
                write_error(paths.error, error)
            finally:
                with self._lock:
                    state = self._states[job_id]
                    state.status = "failed"
            return

        with self._lock:
            state = self._states[job_id]
            state.process = process
            cancelled = state.status == "cancelled"

        if cancelled and process.poll() is None:
            try:
                process.kill()
            except OSError:
                pass

        return_code = process.wait()

        with self._lock:
            state = self._states[job_id]
            state.process = None
            if state.status == "cancelled":
                return

            if paths.result.is_file():
                state.status = "completed"
                return

            if paths.error.is_file():
                state.status = "failed"
                return

        error = ApiError(
            code=ErrorCode.E_WORKER_CRASHED.value,
            message_key="errors.workerCrashed",
            detail={"return_code": return_code},
        )
        try:
            write_error(paths.error, error)
        finally:
            with self._lock:
                state = self._states[job_id]
                state.status = "failed"

    @staticmethod
    def _infer_status(paths: JobPaths) -> str:
        """Deduce el estado de un job que no está en memoria."""
        if paths.result.is_file():
            return "completed"
        if paths.error.is_file():
            return "failed"
        return "queued"

    @staticmethod
    def _read_progress(path: Path) -> Progress | None:
        """Lee el progreso del job, si existe."""
        if not path.is_file():
            return None
        try:
            return Progress.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PythomicsError(
                ErrorCode.E_UNEXPECTED,
                detail={"file": path.name, "reason": str(exc)},
            ) from exc

    @staticmethod
    def _read_result(path: Path) -> ModelResult | None:
        """Lee el resultado del job, si existe."""
        if not path.is_file():
            return None
        try:
            return ModelResult.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PythomicsError(
                ErrorCode.E_UNEXPECTED,
                detail={"file": path.name, "reason": str(exc)},
            ) from exc

    @staticmethod
    def _read_error(path: Path) -> ApiError | None:
        """Lee el error estructurado del job, si existe."""
        if not path.is_file():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and "error" in payload:
                payload = payload["error"]
            return ApiError.model_validate(payload)
        except (OSError, ValueError) as exc:
            raise PythomicsError(
                ErrorCode.E_UNEXPECTED,
                detail={"file": path.name, "reason": str(exc)},
            ) from exc
