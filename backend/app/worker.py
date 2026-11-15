"""Worker analítico en un proceso hijo.

El proceso de la API no importa ``pythomics.models`` ni ``rpy2``. Este módulo
se ejecuta como proceso separado::

    python -m app.worker <spec.json>

La especificación recibida contiene la receta completa y las rutas del
protocolo de archivos. El worker materializa los CSV, los alinea por ID,
registra el progreso por etapa y escribe el resultado o el error.

El preprocesamiento queda deliberadamente fuera del MVP: la etapa
``preprocess`` deja constancia, pero no transforma los datos. ``NipalsPCA``
centra por defecto y no escala, que son los valores predeterminados de
mixOmics.
"""

from __future__ import annotations

import csv
import json
import secrets
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import pandas as pd

from app.errors import ErrorCode, PythomicsError
from app.jobs import write_error, write_json_atomic
from app.schemas import (
    BlockRef,
    JobSpec,
    ModelResult,
    Progress,
    Provenance,
    VariableLoading,
)

#: Etapas del pipeline, en orden. El índice es base 0.
STAGES = (
    "load",
    "align",
    "preprocess",
    "fit",
    "transform",
    "figures",
)

#: Cantidad total de etapas del progreso.
TOTAL_STAGES = len(STAGES)


@dataclass(slots=True)
class _LoadedBlock:
    """Bloque materializado, todavía sin alinear."""

    reference: BlockRef
    frame: pd.DataFrame
    id_column: str
    numeric_columns: list[str]


@dataclass(slots=True)
class _FittedModel:
    """Ajuste PCA de un bloque de variables."""

    block_name: str
    estimator: Any
    variables: list[str]
    matrix: pd.DataFrame


def _write_progress(path: Path, stage: str) -> None:
    """Escribe atómicamente la etapa actual del trabajo."""
    if stage == "queued":
        index = 0
    else:
        index = STAGES.index(stage)
    write_json_atomic(
        path,
        Progress(stage=stage, index=index, total=TOTAL_STAGES).model_dump(
            mode="json"
        ),
    )


def _detect_delimiter(path: Path) -> str:
    """Detecta el separador del CSV o TSV de entrada."""
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as archivo:
            muestra = archivo.read(64 * 1024)
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"file": path.name, "reason": str(exc)},
        ) from exc

    if muestra.strip():
        try:
            return csv.Sniffer().sniff(muestra, delimiters=",\t;").delimiter
        except csv.Error:
            pass

    return "\t" if path.suffix.lower() == ".tsv" else ","


def _read_frame(path: Path, reference: BlockRef) -> pd.DataFrame:
    """Lee un bloque como tabla de texto, sin inferir tipos."""
    delimiter = _detect_delimiter(path)
    try:
        frame = pd.read_csv(
            path,
            sep=delimiter,
            dtype=str,
            keep_default_na=False,
        )
    except (OSError, pd.errors.ParserError) as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"file": reference.name, "reason": str(exc)},
        ) from exc

    if frame.empty or len(frame.columns) == 0:
        raise PythomicsError(
            ErrorCode.E_EMPTY_FILE,
            detail={"file": reference.name},
        )

    return frame


def _numeric_columns(
    frame: pd.DataFrame,
    reference: BlockRef,
    delimiter: str,
) -> list[str]:
    """Selecciona las columnas numéricas declaradas por la receta."""
    categoricas = set(reference.categorical_columns)
    selected: list[str] = []

    for column in frame.columns[1:]:
        nombre = str(column)
        if nombre in categoricas:
            continue

        valores = frame[column].astype(str).str.strip()
        if delimiter != ",":
            valores = valores.str.replace(",", ".", regex=False)
        convertidos = pd.to_numeric(valores, errors="coerce")

        if convertidos.isna().any():
            raise PythomicsError(
                ErrorCode.E_NOT_NUMERIC,
                detail={
                    "block": reference.name,
                    "column": nombre,
                },
            )

        selected.append(nombre)

    return selected


def _load_blocks(blocks: list[BlockRef]) -> list[_LoadedBlock]:
    """Materializa todos los bloques de la receta.

    Se cargan también los bloques de metadatos: el bloque del target tiene
    que alinearse por ID aunque sus variables no entren al PCA.
    """
    loaded: list[_LoadedBlock] = []

    for reference in blocks:
        path = Path(reference.path)
        frame = _read_frame(path, reference)
        delimiter = _detect_delimiter(path)
        id_column = str(frame.columns[0])
        numeric = _numeric_columns(frame, reference, delimiter)

        if len(frame) != reference.n_samples:
            raise PythomicsError(
                ErrorCode.E_BLOCK_ROWS_MISMATCH,
                detail={
                    "block": reference.name,
                    "expected_rows": reference.n_samples,
                    "found_rows": len(frame),
                },
            )

        loaded.append(
            _LoadedBlock(
                reference=reference,
                frame=frame,
                id_column=id_column,
                numeric_columns=numeric,
            )
        )

    return loaded


def _validate_target(
    loaded: list[_LoadedBlock],
    target: Any,
) -> None:
    """Comprueba que el bloque y la columna del target existan."""
    if target is None:
        return

    bloque = next(
        (
            candidate
            for candidate in loaded
            if candidate.reference.name == target.block
        ),
        None,
    )
    if bloque is None:
        raise PythomicsError(
            ErrorCode.E_TARGET_COLUMN_MISSING,
            detail={"block": target.block, "column": target.column},
        )

    if target.column not in bloque.frame.columns:
        raise PythomicsError(
            ErrorCode.E_TARGET_COLUMN_MISSING,
            detail={"block": target.block, "column": target.column},
        )


def _align_blocks(
    loaded: list[_LoadedBlock],
    sample_ids: list[str],
) -> list[_LoadedBlock]:
    """Alinea todos los bloques por la lista canónica de IDs."""
    if not sample_ids:
        raise PythomicsError(
            ErrorCode.E_NO_COMMON_SAMPLES,
            detail={"reason": "empty_alignment"},
        )

    aligned: list[_LoadedBlock] = []
    for block in loaded:
        indexed = block.frame.set_index(block.id_column, drop=False)
        available = set(indexed.index.astype(str))
        faltantes = [
            sample_id for sample_id in sample_ids if sample_id not in available
        ]
        if faltantes:
            raise PythomicsError(
                ErrorCode.E_BLOCK_ROWS_MISMATCH,
                detail={
                    "block": block.reference.name,
                    "missing_samples": len(faltantes),
                    "examples": faltantes[:10],
                },
            )

        frame = indexed.loc[sample_ids].reset_index(drop=True)
        aligned.append(
            _LoadedBlock(
                reference=block.reference,
                frame=frame,
                id_column=block.id_column,
                numeric_columns=block.numeric_columns,
            )
        )

    return aligned


def _fit_pca(
    blocks: list[_LoadedBlock],
    n_components: int,
) -> list[_FittedModel]:
    """Ajusta un ``NipalsPCA`` por cada bloque de variables.

    La importación se hace dentro de la función: el proceso de la API nunca
    carga ``pythomics`` ni R.
    """
    try:
        from pythomics.tools import NipalsPCA
    except ImportError as exc:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "pythomics_not_available"},
        ) from exc

    feature_blocks = [
        block for block in blocks if block.reference.role == "block"
    ]
    if not feature_blocks:
        raise PythomicsError(
            ErrorCode.E_NOT_NUMERIC,
            detail={"reason": "no_feature_blocks"},
        )

    fitted: list[_FittedModel] = []
    for block in feature_blocks:
        if not block.numeric_columns:
            raise PythomicsError(
                ErrorCode.E_NOT_NUMERIC,
                detail={"block": block.reference.name},
            )

        matrix = block.frame[block.numeric_columns].astype(float)
        estimator = NipalsPCA(
            n_components=n_components,
            center=True,
            scale=False,
        )
        estimator.fit(matrix.to_numpy())
        fitted.append(
            _FittedModel(
                block_name=block.reference.name,
                estimator=estimator,
                variables=list(block.numeric_columns),
                matrix=matrix,
            )
        )

    return fitted


def _pythomics_version() -> str:
    """Obtiene la versión instalada de pythomics para la provenance."""
    try:
        return version("pythomics")
    except PackageNotFoundError:
        return "unknown"


def _effective_seed(seed: int | None) -> int:
    """Devuelve la semilla pedida o genera una y la deja registrada."""
    if seed is not None:
        return seed
    return secrets.randbelow(2**63)


def _build_result(
    fitted: list[_FittedModel],
    *,
    n_components: int,
    seed: int | None,
) -> ModelResult:
    """Construye el resultado serializable a partir de los ajustes PCA."""
    scores: dict[str, list[list[float]]] = {}
    loadings: dict[str, list[VariableLoading]] = {}
    explained_variance_ratio: list[float] | None = None

    for model in fitted:
        transformed = model.estimator.transform(model.matrix.to_numpy())
        scores[model.block_name] = transformed.tolist()

        variables: list[VariableLoading] = []
        for variable_index, variable in enumerate(model.variables):
            for component_index in range(n_components):
                variables.append(
                    VariableLoading(
                        variable_id=variable,
                        loading=float(
                            model.estimator.loadings_[
                                variable_index,
                                component_index,
                            ]
                        ),
                        component=component_index + 1,
                    )
                )
        loadings[model.block_name] = variables

        if explained_variance_ratio is None:
            explained_variance_ratio = [
                float(value)
                for value in model.estimator.explained_variance_ratio_
            ]

    effective_seed = _effective_seed(seed)
    provenance = Provenance(
        pythomics_version=_pythomics_version(),
        seed=effective_seed,
        params={
            "center": True,
            "scale": False,
            "n_components": n_components,
            "preprocessing": [],
        },
        preprocessing=[],
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    return ModelResult(
        model_type="PCA",
        blocks=[model.block_name for model in fitted],
        n_components=n_components,
        explained_variance_ratio=explained_variance_ratio,
        scores=scores,
        loadings=loadings,
        figures=[],
        provenance=provenance,
    )


def run_job(spec: JobSpec) -> None:
    """Ejecuta el trabajo descrito por la especificación."""
    progress_path = Path(spec.paths.progress)
    result_path = Path(spec.paths.result)

    _write_progress(progress_path, "queued")

    _write_progress(progress_path, "load")
    loaded = _load_blocks(spec.blocks)

    _write_progress(progress_path, "align")
    if spec.alignment is None or not spec.alignment.confirmed:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "alignment_not_confirmed"},
        )
    _validate_target(loaded, spec.target)
    aligned = _align_blocks(loaded, spec.alignment.sample_ids)

    _write_progress(progress_path, "preprocess")
    # RF-3 queda fuera del MVP: esta etapa deja constancia y no transforma.

    _write_progress(progress_path, "fit")
    if spec.model.model_type == "DIABLO":
        raise PythomicsError(
            ErrorCode.E_NOT_IMPLEMENTED,
            detail={"model_type": "DIABLO"},
        )
    fitted = _fit_pca(aligned, spec.model.n_components)

    _write_progress(progress_path, "transform")
    result = _build_result(
        fitted,
        n_components=spec.model.n_components,
        seed=spec.model.seed,
    )

    _write_progress(progress_path, "figures")
    # Las figuras de PCA se incorporan en T8; T7 completa el protocolo.

    write_json_atomic(result_path, result.model_dump(mode="json"))


def main(argv: list[str] | None = None) -> int:
    """Punto de entrada del proceso hijo."""
    argumentos = list(sys.argv[1:] if argv is None else argv)
    if len(argumentos) != 1:
        print("Uso: python -m app.worker <spec.json>", file=sys.stderr)
        return 2

    spec_path = Path(argumentos[0])
    try:
        spec = JobSpec.model_validate_json(
            spec_path.read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as exc:
        print(f"No se pudo leer la especificación: {exc}", file=sys.stderr)
        return 2

    try:
        run_job(spec)
    except PythomicsError as exc:
        try:
            write_error(Path(spec.paths.error), exc.to_api_error())
        except OSError as write_exc:
            print(f"No se pudo escribir el error: {write_exc}", file=sys.stderr)
        print(json.dumps(exc.to_envelope().model_dump(mode="json")), file=sys.stderr)
        return 1
    except Exception as exc:
        error = PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": type(exc).__name__, "message": str(exc)},
        )
        try:
            write_error(Path(spec.paths.error), error.to_api_error())
        except OSError as write_exc:
            print(f"No se pudo escribir el error: {write_exc}", file=sys.stderr)
        print(json.dumps(error.to_envelope().model_dump(mode="json")), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
