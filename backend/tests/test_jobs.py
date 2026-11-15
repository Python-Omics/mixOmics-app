"""Pruebas del contrato de jobs y del worker separado (T7).

La API no materializa matrices: crea un job, el worker hijo carga los bloques
y el contrato se consulta por HTTP. Estas pruebas cubren la cola serial, el
progreso por etapa, la cancelación, los errores y el aislamiento del proceso.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import quote

import pytest

from app.api import app
from app.schemas import Capabilities

#: Formato estricto del identificador de un job.
JOB_ID_PATTERN = re.compile(r"^job_[0-9a-f]{12}$")


def _crear_dataset_alineado(
    client: Any,
    write_block: Any,
    *,
    confirmed: bool = True,
) -> str:
    """Crea un dataset de un bloque y confirma su alineación."""
    write_block(
        "gene.csv",
        "sample,g1,g2\nS1,1.5,2.5\nS2,3.5,4.5\nS3,5.5,6.5\n",
    )
    dataset = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "gene.csv", "role": "block"}]},
    )
    assert dataset.status_code == 201, dataset.text
    dataset_id = dataset.json()["id"]

    alignment = client.post(
        f"/v1/datasets/{dataset_id}/align/",
        json={"blocks": ["gene.csv"], "confirmed": confirmed},
    )
    assert alignment.status_code == 200, alignment.text
    return dataset_id


def _esperar_job(
    client: Any,
    job_id: str,
    *,
    timeout_s: float = 15.0,
) -> dict[str, Any]:
    """Espera a que un job alcance un estado terminal y devuelve su JSON."""
    limite = time.monotonic() + timeout_s
    ultimo: dict[str, Any] = {}
    while time.monotonic() < limite:
        respuesta = client.get(f"/v1/jobs/{job_id}/")
        assert respuesta.status_code == 200, respuesta.text
        ultimo = respuesta.json()
        if ultimo["status"] in {"completed", "failed", "cancelled"}:
            return ultimo
        time.sleep(0.02)
    raise AssertionError(f"El job no terminó dentro del plazo: {ultimo}")


def test_post_model_acepta_la_peticion_y_devuelve_un_job_id(
    client: Any,
    write_block: Any,
) -> None:
    """Una solicitud válida se acepta con 202 y un identificador verificable."""
    write_block(
        "gene.csv",
        "sample,g1,g2\nS1,1.5,2.5\nS2,3.5,4.5\nS3,5.5,6.5\n",
    )
    dataset = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "gene.csv", "role": "block"}]},
    )
    assert dataset.status_code == 201, dataset.text

    respuesta = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset.json()["id"],
            "model_type": "PCA",
            "n_components": 2,
        },
    )

    assert respuesta.status_code == 202, respuesta.text
    job_id = respuesta.json()["job_id"]
    assert JOB_ID_PATTERN.match(job_id)
    estado = client.get(f"/v1/jobs/{job_id}/")
    assert estado.status_code == 200, estado.text
    assert estado.json()["status"] in {"queued", "running"}


def test_job_termina_y_su_resultado_se_refleja_en_la_api(
    client: Any,
    write_block: Any,
    data_dir: Path,
) -> None:
    """El hijo escribe el resultado y GET lo devuelve como parte del job."""
    dataset_id = _crear_dataset_alineado(client, write_block)
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text
    job_id = aceptado.json()["job_id"]

    job = _esperar_job(client, job_id)

    assert job["status"] == "completed", job
    assert job["result"]["model_type"] == "PCA"
    assert job["result"]["n_components"] == 2
    assert job["result"]["provenance"]["params"]["center"] is True
    assert job["result"]["provenance"]["params"]["scale"] is False
    assert job["result"]["provenance"]["preprocessing"] == []
    assert (data_dir / "jobs" / job_id / "result.json").is_file()
    assert (data_dir / "jobs" / job_id / "worker.log").is_file()


def test_cancelar_un_job_deja_el_estado_cancelled(
    client: Any,
    write_block: Any,
) -> None:
    """DELETE cancela el job y el proceso hijo deja de calcular."""
    dataset_id = _crear_dataset_alineado(client, write_block)
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text
    job_id = aceptado.json()["job_id"]

    manager = app.state.JOB_MANAGER
    proceso = None
    limite = time.monotonic() + 10
    while time.monotonic() < limite:
        estado = client.get(f"/v1/jobs/{job_id}/").json()
        with manager._lock:
            registro = manager._states.get(job_id)
            proceso = registro.process if registro is not None else None
        if proceso is not None:
            break
        if estado["status"] in {"completed", "failed", "cancelled"}:
            break
        time.sleep(0.01)

    assert proceso is not None
    assert estado["status"] == "running"

    cancelacion = client.delete(f"/v1/jobs/{job_id}/")

    assert cancelacion.status_code == 202, cancelacion.text
    assert cancelacion.json()["job_id"] == job_id
    assert proceso.poll() is not None
    assert client.get(f"/v1/jobs/{job_id}/").json()["status"] == "cancelled"


def test_el_worker_solo_usa_variables_numericas_de_los_bloques_de_features(
    client: Any,
    write_block: Any,
) -> None:
    """Las columnas categóricas no entran al PCA aunque el bloque sea de datos."""
    write_block(
        "mixto.csv",
        "sample,g1,etiqueta\nS1,1,A\nS2,2,B\nS3,3,A\n",
    )
    dataset = client.post(
        "/v1/datasets/",
        json={"blocks": [{"name": "mixto.csv", "role": "block"}]},
    )
    assert dataset.status_code == 201, dataset.text
    dataset_id = dataset.json()["id"]
    alineacion = client.post(
        f"/v1/datasets/{dataset_id}/align/",
        json={"blocks": ["mixto.csv"], "confirmed": True},
    )
    assert alineacion.status_code == 200, alineacion.text

    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 1,
        },
    )
    assert aceptado.status_code == 202, aceptado.text

    job = _esperar_job(client, aceptado.json()["job_id"])

    assert job["status"] == "completed", job
    variables = {
        loading["variable_id"]
        for loading in job["result"]["loadings"]["mixto.csv"]
    }
    assert variables == {"g1"}


def test_el_worker_alinea_tambien_el_bloque_del_target(
    client: Any,
    write_block: Any,
) -> None:
    """Una alteração en el target impede alinear el job completo por ID."""
    write_block("gene.csv", "sample,g1\nS1,1\nS2,2\n")
    write_block("meta.csv", "sample,grupo\nS1,A\nS2,B\n")
    dataset = client.post(
        "/v1/datasets/",
        json={
            "blocks": [
                {"name": "gene.csv", "role": "block"},
                {"name": "meta.csv", "role": "metadata"},
            ],
            "target": {"block": "meta.csv", "column": "grupo"},
        },
    )
    assert dataset.status_code == 201, dataset.text
    dataset_id = dataset.json()["id"]
    alineacion = client.post(
        f"/v1/datasets/{dataset_id}/align/",
        json={"blocks": ["gene.csv", "meta.csv"], "confirmed": True},
    )
    assert alineacion.status_code == 200, alineacion.text

    # La receta conserva la decisión, pero el archivo del target cambia antes
    # de que el worker lo materialice.
    write_block("meta.csv", "sample,grupo\nS1,A\nX2,B\n")
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 1,
        },
    )
    assert aceptado.status_code == 202, aceptado.text

    job = _esperar_job(client, aceptado.json()["job_id"])

    assert job["status"] == "failed", job
    assert job["error"]["code"] == "E_BLOCK_ROWS_MISMATCH"
    assert job["error"]["detail"]["block"] == "meta.csv"


def test_columna_de_target_inexistente_hace_fallar_el_job(
    client: Any,
    write_block: Any,
) -> None:
    """El worker comprueba que la columna de clase exista en su bloque."""
    write_block("gene.csv", "sample,g1\nS1,1\nS2,2\n")
    write_block("meta.csv", "sample,grupo\nS1,A\nS2,B\n")
    dataset = client.post(
        "/v1/datasets/",
        json={
            "blocks": [
                {"name": "gene.csv", "role": "block"},
                {"name": "meta.csv", "role": "metadata"},
            ]
        },
    )
    assert dataset.status_code == 201, dataset.text
    dataset_id = dataset.json()["id"]
    alineacion = client.post(
        f"/v1/datasets/{dataset_id}/align/",
        json={"blocks": ["gene.csv", "meta.csv"], "confirmed": True},
    )
    assert alineacion.status_code == 200, alineacion.text

    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 1,
            "target": {"block": "meta.csv", "column": "clase-inexistente"},
        },
    )
    assert aceptado.status_code == 202, aceptado.text

    job = _esperar_job(client, aceptado.json()["job_id"])

    assert job["status"] == "failed", job
    assert job["error"]["code"] == "E_TARGET_COLUMN_MISSING"
    assert job["error"]["detail"]["column"] == "clase-inexistente"


def test_target_de_un_bloque_ajeno_se_rechaza_antes_de_encolar(
    client: Any,
    write_block: Any,
) -> None:
    """La solicitud de modelo valida que el bloque del target pertenezca."""
    dataset_id = _crear_dataset_alineado(client, write_block)

    respuesta = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
            "target": {"block": "otro.csv", "column": "clase"},
        },
    )

    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["error"]["code"] == "E_TARGET_COLUMN_MISSING"


def test_job_con_identificador_invalido_no_toca_el_disco(
    client: Any,
    data_dir: Path,
) -> None:
    """El formato del identificador se valida antes de resolver una ruta."""
    respuesta = client.get("/v1/jobs/no-es-un-job/")

    assert respuesta.status_code == 404, respuesta.text
    assert respuesta.json()["error"]["code"] == "E_JOB_NOT_FOUND"
    assert not (data_dir / "jobs" / "no-es-un-job").exists()


def test_dataset_inexistente_devuelve_el_error_uniforme(
    client: Any,
) -> None:
    """Un identificador de dataset desconocido no crea ningún job."""
    respuesta = client.post(
        "/v1/model/",
        json={
            "dataset_id": "ds_0123456789ab",
            "model_type": "PCA",
            "n_components": 2,
        },
    )

    assert respuesta.status_code == 404, respuesta.text
    assert respuesta.json()["error"]["code"] == "E_UNKNOWN_DATASET"
    assert respuesta.json()["error"]["message_key"] == "errors.unknownDataset"


def test_un_worker_que_muere_sin_resultado_deja_el_job_failed(
    client: Any,
    write_block: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Si el hijo muere sin resultado, la API registra el fallo del worker."""
    dataset_id = _crear_dataset_alineado(client, write_block)

    class ProcesoFallido:
        """Proceso simulado que termina sin escribir archivos."""

        def poll(self) -> int | None:
            return 9

        def wait(self) -> int:
            return 9

        def kill(self) -> None:
            return None

    monkeypatch.setattr(
        "app.jobs.subprocess",
        SimpleNamespace(
            Popen=lambda *args, **kwargs: ProcesoFallido(),
            STDOUT=subprocess.STDOUT,
        ),
    )
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text

    job = _esperar_job(client, aceptado.json()["job_id"])

    assert job["status"] == "failed", job
    assert job["error"]["code"] == "E_WORKER_CRASHED"
    assert job["error"]["detail"]["return_code"] == 9


def test_alineacion_sin_confirmar_hace_fallar_el_job(
    client: Any,
    write_block: Any,
    data_dir: Path,
) -> None:
    """El worker rechaza una alineación que el usuario todavía no confirmó."""
    dataset_id = _crear_dataset_alineado(client, write_block, confirmed=False)
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text
    job_id = aceptado.json()["job_id"]

    job = _esperar_job(client, job_id)

    assert job["status"] == "failed", job
    assert job["error"]["code"] == "E_ANALYSIS_FAILED"
    assert job["error"]["detail"]["reason"] == "alignment_not_confirmed"
    assert (data_dir / "jobs" / job_id / "error.json").is_file()


def test_la_cola_procesa_un_job_a_la_vez(
    client: Any,
    write_block: Any,
) -> None:
    """El segundo job permanece en cola hasta que termina el primero."""
    dataset_id = _crear_dataset_alineado(client, write_block)
    cuerpo = {
        "dataset_id": dataset_id,
        "model_type": "PCA",
        "n_components": 2,
    }
    primero = client.post("/v1/model/", json=cuerpo)
    segundo = client.post("/v1/model/", json=cuerpo)
    assert primero.status_code == 202, primero.text
    assert segundo.status_code == 202, segundo.text

    primero_id = primero.json()["job_id"]
    segundo_id = segundo.json()["job_id"]
    estado_segundo = client.get(f"/v1/jobs/{segundo_id}/").json()

    assert estado_segundo["status"] == "queued"
    assert _esperar_job(client, primero_id)["status"] == "completed"
    assert _esperar_job(client, segundo_id)["status"] == "completed"


def test_el_spec_y_el_progreso_son_completos_y_debuggeables(
    client: Any,
    write_block: Any,
    data_dir: Path,
) -> None:
    """El spec contiene todo lo necesario y el progreso termina en figuras."""
    dataset_id = _crear_dataset_alineado(client, write_block)
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
            "keepX": {"gene.csv": [2, 2]},
            "design": [[1.0]],
            "seed": 17,
        },
    )
    assert aceptado.status_code == 202, aceptado.text
    job_id = aceptado.json()["job_id"]

    job = _esperar_job(client, job_id)
    assert job["status"] == "completed", job

    directory = data_dir / "jobs" / job_id
    spec = json.loads((directory / "spec.json").read_text(encoding="utf-8"))
    progress = json.loads(
        (directory / "progress.json").read_text(encoding="utf-8")
    )

    assert spec["job_id"] == job_id
    assert spec["dataset_id"] == dataset_id
    assert spec["blocks"][0]["name"] == "gene.csv"
    assert spec["blocks"][0]["role"] == "block"
    assert spec["blocks"][0]["path"].endswith("gene.csv")
    assert spec["blocks"][0]["sample_ids"] == ["S1", "S2", "S3"]
    assert spec["alignment"]["sample_ids"] == ["S1", "S2", "S3"]
    assert spec["alignment"]["confirmed"] is True
    assert spec["model"] == {
        "model_type": "PCA",
        "n_components": 2,
        "keepX": {"gene.csv": [2, 2]},
        "design": [[1.0]],
        "seed": 17,
    }
    assert set(spec["paths"]) == {"spec", "progress", "result", "error", "log"}
    assert progress == {"stage": "figures", "index": 5, "total": 6}


def test_la_api_no_importa_pythomics_models() -> None:
    """S30: el proceso de FastAPI nunca carga el módulo analítico de R."""
    assert "pythomics.models" not in sys.modules


def test_diablo_devuelve_un_error_explicito_de_no_implementado(
    client: Any,
    write_block: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DIABLO queda explícitamente diferido hasta T9."""
    dataset_id = _crear_dataset_alineado(client, write_block)

    async def con_r() -> Capabilities:
        return Capabilities(pythomics=True, r=True, mixomics=True)

    monkeypatch.setattr("app.api.probe_capabilities_async", con_r)
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "DIABLO",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text

    job = _esperar_job(client, aceptado.json()["job_id"])

    assert job["status"] == "failed", job
    assert job["error"]["code"] == "E_NOT_IMPLEMENTED"
    assert job["error"]["detail"]["model_type"] == "DIABLO"


def test_model_sin_R_devuelve_503_con_el_error_uniforme(
    client: Any,
    write_block: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Un modelo que necesita R no se acepta si el entorno no lo ofrece."""
    dataset_id = _crear_dataset_alineado(client, write_block)

    async def sin_r() -> Capabilities:
        return Capabilities(pythomics=True, r=False, mixomics=False)

    monkeypatch.setattr("app.api.probe_capabilities_async", sin_r)
    respuesta = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "DIABLO",
            "n_components": 2,
        },
    )

    assert respuesta.status_code == 503, respuesta.text
    assert respuesta.json()["error"]["code"] == "E_R_NOT_AVAILABLE"
    assert respuesta.json()["error"]["message_key"] == "errors.rNotAvailable"


def test_el_endpoint_de_figuras_sirve_solo_el_archivo_del_job(
    client: Any,
    write_block: Any,
    data_dir: Path,
) -> None:
    """Una figura válida se sirve; un nombre con traversal no puede escapar."""
    dataset_id = _crear_dataset_alineado(client, write_block)
    aceptado = client.post(
        "/v1/model/",
        json={
            "dataset_id": dataset_id,
            "model_type": "PCA",
            "n_components": 2,
        },
    )
    assert aceptado.status_code == 202, aceptado.text
    job_id = aceptado.json()["job_id"]

    figura = data_dir / "jobs" / job_id / "scores.png"
    figura.write_bytes(b"contenido-de-prueba")
    (data_dir / "secreto.png").write_bytes(b"no-debe-salir")

    valida = client.get(f"/v1/files/{job_id}/scores.png")
    traversal = client.get(
        f"/v1/files/{job_id}/{quote('../secreto.png', safe='')}"
    )

    assert valida.status_code == 200, valida.text
    assert valida.content == b"contenido-de-prueba"
    assert valida.headers["content-type"] == "image/png"
    assert traversal.status_code != 200
    assert b"no-debe-salir" not in traversal.content
