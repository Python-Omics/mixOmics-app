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

El DIABLO (RF-8) se ajusta con ``DIABLOWrapper``, que llama a ``block.splsda``
de mixOmics en R: el resultado **es** el de R, y la paridad es inherente. Es
un modelo **supervisado**: sin variable de clase no se puede ajustar.

Las figuras se generan **acá**, en el proceso hijo: el proceso de la API
nunca importa matplotlib ni ``pythomics.visualizations``.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
import secrets
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from app.errors import ErrorCode, PythomicsError
from app.jobs import write_error, write_json_atomic
from app.schemas import (
    Biomarker,
    BlockRef,
    DataFileFingerprint,
    Figure,
    JobSpec,
    ModelResult,
    Progress,
    Provenance,
    TargetSpec,
    VariableLoading,
)

#: Registrador del worker. Los avisos salen por stderr, que el proceso
#: padre redirige al ``worker.log`` del job.
logger = logging.getLogger(__name__)

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

#: Prefijo de los archivos de figura con los scores (sample plot).
PREFIXO_FIGURA_SCORES = "scores"

#: Nombre de la figura con los loadings de los biomarcadores (DIABLO).
NOMBRE_FIGURA_BIOMARKERS = "biomarkers"

#: Nombre de la figura con el círculo de correlaciones (DIABLO).
NOMBRE_FIGURA_CIRCOS = "circos"

#: Nombre de la figura con el heatmap de loadings (DIABLO).
NOMBRE_FIGURA_HEATMAP = "heatmap"

#: Nombre de la figura con la red de relevancia (DIABLO).
NOMBRE_FIGURA_NETWORK = "network"

#: Paleta de colores de las clases en el círculo de correlaciones.
COLORES_CLASES = (
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
)

#: Paleta de colores de los bloques en el heatmap y en la red de
#: relevancia.
#:
#: El heatmap colorea las columnas por **bloque** y la red colorea los
#: nodos por **bloque** también (son los bloques los que agrupan las
#: variables). Se usa la misma paleta sobria que la de las clases para que
#: las figuras de un mismo análisis se vean juntas.
COLORES_BLOQUES = (
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
)

#: Cantidad de variables por bloque que muestran el heatmap (CIM) y la red
#: de relevancia.
#:
#: La biblioteca dibuja **todas** las variables del modelo: con un modelo
#: real (breast.TCGA: 200 variables de mRNA, 184 de miRNA y 142 de
#: proteína) el heatmap tiene más de 500 columnas y la red de relevancia es
#: un enredo ilegible. Las dos figuras usan solo las variables más
#: importantes de cada bloque: las que el modelo seleccionó.
VARIABLES_POR_BLOQUE_FIGURAS = 20

#: Cantidad de muestras a partir de la cual el heatmap omite los
#: identificadores de muestra: con muchas muestras los nombres se
#: superponen y no se leen (el color de la fila ya dice la clase).
UMBRAL_NOMBRES_MUESTRA_HEATMAP = 60

#: Cortes de correlación que se prueban para la red de relevancia, del más
#: estricto al más laxo.
#:
#: Con datos weakly discriminantes ninguna correlación llega a 0.5 y la red
#: quedaría vacía: se afloja el corte antes de abandonar la figura. El corte
#: que se usó queda escrito en el título de la figura.
CORTES_RELEVANCE = (0.5, 0.4, 0.3, 0.2)

#: Tamaño de lectura para el cálculo de la huella de los archivos.
TAMANO_HASH = 1024 * 1024


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


@dataclass(slots=True)
class _FittedDiablo:
    """Ajuste DIABLO de varios bloques de variables.

    ``model`` es el ``DIABLOWrapper`` de la biblioteca: expone los variates
    (``transform``), los loadings (``loadings_``), los nombres de las
    variables (``names_``) y los biomarcadores (``get_biomarkers``).
    """

    model: Any
    blocks: list[str]
    variables: dict[str, list[str]]
    classes: list[str]
    seed: int
    n_components: int
    design: list[list[float]]
    keepX: dict[str, list[int]] | None


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


# ---------------------------------------------------------------------------
# DIABLO (RF-8): el modelo supervisado multi-bloque
# ---------------------------------------------------------------------------


def _clases_de_la_variable(valores: Any) -> list[str]:
    """Clases distintas de la variable de clase, en orden de aparición."""
    vistas: dict[str, None] = {}
    for valor in valores:
        vistas.setdefault(str(valor), None)
    return list(vistas)


def _matrices_diablo(
    bloques: list[_LoadedBlock],
    target: TargetSpec | None,
) -> tuple[dict[str, pd.DataFrame], np.ndarray]:
    """Arma el diccionario de bloques y el vector de clase del DIABLO.

    Solo entran los bloques con rol ``block``: la tabla de phenotypes aporta
    la clase, no variables. La columna de clase se excluye de las variables
    aunque su bloque tenga rol ``block``: una variable de clase nunca es una
    variable del modelo.

    El vector de clase sale del bloque **alineado**, así que viene en el
    orden canónico de las muestras: la clase nunca se asigna a la muestra
    equivocada (S39).
    """
    if target is None:
        raise PythomicsError(
            ErrorCode.E_TARGET_COLUMN_MISSING,
            detail={
                "reason": "diablo_requires_target",
                "model_type": "DIABLO",
            },
        )

    bloque_clase = next(
        (
            candidate
            for candidate in bloques
            if candidate.reference.name == target.block
        ),
        None,
    )
    if bloque_clase is None:
        raise PythomicsError(
            ErrorCode.E_TARGET_COLUMN_MISSING,
            detail={"block": target.block, "column": target.column},
        )

    if target.column not in bloque_clase.frame.columns:
        raise PythomicsError(
            ErrorCode.E_TARGET_COLUMN_MISSING,
            detail={"block": target.block, "column": target.column},
        )

    matrices: dict[str, pd.DataFrame] = {}
    for bloque in bloques:
        if bloque.reference.role != "block":
            continue

        variables = [
            columna
            for columna in bloque.numeric_columns
            if not (
                bloque.reference.name == target.block
                and columna == target.column
            )
        ]
        if not variables:
            raise PythomicsError(
                ErrorCode.E_NOT_NUMERIC,
                detail={
                    "block": bloque.reference.name,
                    "reason": "no_numeric_variables",
                },
            )

        matrices[bloque.reference.name] = bloque.frame[variables].astype(float)

    if not matrices:
        raise PythomicsError(
            ErrorCode.E_NOT_NUMERIC,
            detail={"reason": "no_feature_blocks"},
        )

    clase = bloque_clase.frame[target.column].astype(str).to_numpy()
    return matrices, clase


def _design_efectivo(
    design: list[list[float]] | None,
    n_bloques: int,
) -> list[list[float]]:
    """Matriz de diseño efectiva del DIABLO.

    Sin diseño explícito se usa el valor predeterminado de mixOmics: ceros en
    la diagonal y unos en el resto (todos los bloques se conectan entre sí).
    """
    if design is None:
        return [
            [0.0 if fila == columna else 1.0 for columna in range(n_bloques)]
            for fila in range(n_bloques)
        ]

    matriz = [[float(valor) for valor in fila] for fila in design]
    filas = len(matriz)
    columnas = len(matriz[0]) if filas else 0

    if filas != n_bloques or columnas != n_bloques:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={
                "reason": "invalid_design",
                "expected_shape": [n_bloques, n_bloques],
                "received_shape": [filas, columnas],
            },
        )

    return matriz


def _keepX_efectivo(
    keepX: dict[str, list[int]] | None,
    bloques: list[str],
    n_components: int,
) -> dict[str, list[int]] | None:
    """Normaliza el ``keepX`` del model request a la convención de mixOmics.

    En mixOmics ``keepX`` es una lista con una entrada por bloque, y cada
    entrada tiene un valor por componente. Un bloque desconocido o una
    longitud que no corresponde son un error del request, no un silencio de R.
    """
    if keepX is None:
        return None

    desconocidos = sorted(name for name in keepX if name not in bloques)
    if desconocidos:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={
                "reason": "keepX_unknown_block",
                "unknown_blocks": desconocidos,
                "blocks": bloques,
            },
        )

    efectivo: dict[str, list[int]] = {}
    for name, valores in keepX.items():
        lista = [int(valor) for valor in valores]
        if len(lista) != n_components:
            raise PythomicsError(
                ErrorCode.E_ANALYSIS_FAILED,
                detail={
                    "reason": "keepX_length_mismatch",
                    "block": name,
                    "expected": n_components,
                    "received": len(lista),
                },
            )
        efectivo[name] = lista

    return efectivo


def _fijar_semilla_en_r(semilla: int) -> None:
    """Fija la semilla de R antes del ajuste (RB-6).

    El ajuste de ``block.splsda`` es determinista, pero dejar la semilla
    fijada en R hace que cualquier paso estocástico que aparezca adentro
    (una validación cruzada, un bootstrap) sea reproducible. La semilla que
    se registra en la provenance es la misma.
    """
    try:
        import rpy2.robjects as robjects

        # R acepta enteros de 32 bits con signo: la semilla se reduce.
        robjects.r(f"set.seed({semilla % 2147483647})")
    except Exception:  # pragma: no cover - depende del entorno
        logger.warning("No se pudo fijar la semilla en R.", exc_info=True)


def _fit_diablo(
    bloques: list[_LoadedBlock],
    target: TargetSpec | None,
    *,
    n_components: int,
    design: list[list[float]] | None,
    keepX: dict[str, list[int]] | None,
    seed: int | None,
) -> _FittedDiablo:
    """Ajusta el ``DIABLOWrapper`` con los bloques de variables y la clase.

    La importación es local: el proceso de la API nunca carga R.
    """
    try:
        from pythomics.models import DIABLOWrapper
    except ImportError as exc:
        raise PythomicsError(
            ErrorCode.E_R_NOT_AVAILABLE,
            detail={"reason": "pythomics_models_not_available"},
        ) from exc

    matrices, clase = _matrices_diablo(bloques, target)
    nombres = list(matrices)
    design_efectivo = _design_efectivo(design, len(nombres))
    keepX_efectivo = _keepX_efectivo(keepX, nombres, n_components)
    semilla = _effective_seed(seed)

    _fijar_semilla_en_r(semilla)

    modelo = DIABLOWrapper(
        n_components=n_components,
        design=design_efectivo,
        keepX=keepX_efectivo,
    )

    try:
        modelo.fit(matrices, clase)
    except Exception as exc:
        # La salida de R queda en el log del worker: el error del job dice
        # qué pasó y el log dice qué dijo R.
        logger.exception("El ajuste del DIABLO falló dentro de R.")
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "diablo_failed", "message": str(exc)},
        ) from exc

    variables = {
        nombre: [str(variable) for variable in modelo.names_.get(nombre, [])]
        for nombre in nombres
    }

    return _FittedDiablo(
        model=modelo,
        blocks=nombres,
        variables=variables,
        classes=_clases_de_la_variable(clase),
        seed=semilla,
        n_components=n_components,
        design=design_efectivo,
        keepX=keepX_efectivo,
    )


def _correlacion_entre_variates(
    variates_a: np.ndarray,
    variates_b: np.ndarray,
) -> list[list[float]]:
    """Correlación de Pearson entre los componentes de dos bloques.

    Es la correlación entre los variates (scores) del bloque A y los del
    bloque B: una matriz de ``ncomp_A`` por ``ncomp_B``.
    """
    a = np.asarray(variates_a, dtype=float)
    b = np.asarray(variates_b, dtype=float)

    if a.ndim != 2 or b.ndim != 2 or a.shape[0] != b.shape[0]:
        return [[0.0] * b.shape[1] for _ in range(a.shape[1])]

    muestras = a.shape[0]
    if muestras < 2:
        return [[0.0] * b.shape[1] for _ in range(a.shape[1])]

    centrado_a = a - a.mean(axis=0)
    centrado_b = b - b.mean(axis=0)
    desviacion_a = a.std(axis=0)
    desviacion_b = b.std(axis=0)

    numerador = centrado_a.T @ centrado_b
    denominador = muestras * np.outer(desviacion_a, desviacion_b)

    with np.errstate(divide="ignore", invalid="ignore"):
        correlacion = np.where(
            denominador != 0, numerador / denominador, 0.0
        )

    return [[float(valor) for valor in fila] for fila in correlacion]


def _correlaciones_entre_bloques(
    variates: dict[str, np.ndarray],
    bloques: list[str],
) -> dict[str, list[list[float]]]:
    """Correlación entre cada par de bloques, indexada por el par.

    La clave es ``"bloqueA|bloqueB"``, con los bloques en el orden de la
    receta (el primero es el que fija el orden canónico de las muestras).
    """
    correlaciones: dict[str, list[list[float]]] = {}

    for indice, bloque_a in enumerate(bloques):
        for bloque_b in bloques[indice + 1 :]:
            correlaciones[f"{bloque_a}|{bloque_b}"] = _correlacion_entre_variates(
                variates[bloque_a],
                variates[bloque_b],
            )

    return correlaciones


def _versiones_r() -> tuple[str | None, str | None]:
    """Versión de R y del paquete mixOmics, para la provenance (RB-7)."""
    try:
        import rpy2.robjects as robjects

        version_r = str(robjects.r("R.version.string")[0]).strip()
        version_mixomics = str(
            robjects.r('as.character(packageVersion("mixOmics"))')[0]
        ).strip()
    except Exception:  # pragma: no cover - depende del entorno
        logger.warning("No se pudieron leer las versiones de R.", exc_info=True)
        return None, None

    return version_r, version_mixomics


def _resultado_diablo(
    fitted: _FittedDiablo,
    *,
    n_components: int,
    bloques: list[_LoadedBlock] | None = None,
    target: TargetSpec | None = None,
) -> ModelResult:
    """Construye el resultado serializable del DIABLO.

    Los scores son los variates de cada bloque, los loadings los pesos de
    cada variable en cada componente, los biomarcadores las variables que el
    modelo seleccionó y las correlaciones la relación entre los componentes
    de cada par de bloques.
    """
    modelo = fitted.model
    variates = modelo.transform(modelo.X_dict_)

    scores: dict[str, list[list[float]]] = {}
    for nombre in fitted.blocks:
        matriz = np.asarray(variates[nombre], dtype=float)
        scores[nombre] = [
            [float(valor) for valor in fila] for fila in matriz
        ]

    loadings: dict[str, list[VariableLoading]] = {}
    for nombre in fitted.blocks:
        matriz = modelo.loadings_.get(nombre)
        variables = fitted.variables.get(nombre, [])

        entradas: list[VariableLoading] = []
        if matriz is not None:
            for indice, variable in enumerate(variables):
                for componente in range(n_components):
                    valor = (
                        float(matriz[indice, componente])
                        if componente < matriz.shape[1]
                        else 0.0
                    )
                    entradas.append(
                        VariableLoading(
                            variable_id=variable,
                            loading=valor,
                            component=componente + 1,
                        )
                    )
        loadings[nombre] = entradas

    biomarkers: list[Biomarker] = []
    for nombre in fitted.blocks:
        for componente in range(1, n_components + 1):
            seleccion = modelo.get_biomarkers(nombre, componente)
            for variable, valor in seleccion["value"].items():
                biomarkers.append(
                    Biomarker(
                        variable_id=str(variable),
                        loading=float(valor),
                        stability=None,
                        component=componente,
                        block=nombre,
                    )
                )

    correlations = _correlaciones_entre_bloques(variates, fitted.blocks)

    bloques = bloques or []
    huellas = _data_fingerprint(bloques)
    version_r, version_mixomics = _versiones_r()
    provenance = Provenance(
        pythomics_version=_pythomics_version(),
        r_version=version_r,
        mixomics_version=version_mixomics,
        seed=fitted.seed,
        params={
            "model_type": "DIABLO",
            "estimator": "DIABLOWrapper",
            "center": True,
            "scale": False,
            "n_components": n_components,
            "preprocessing": [],
            "blocks": list(fitted.blocks),
            "target": (
                {"block": target.block, "column": target.column}
                if target is not None
                else None
            ),
            "design": fitted.design,
            "keepX": fitted.keepX,
        },
        preprocessing=[],
        data_files=huellas,
        data_fingerprint=_fingerprint_combinada(huellas),
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    return ModelResult(
        model_type="DIABLO",
        blocks=list(fitted.blocks),
        n_components=n_components,
        explained_variance_ratio=None,
        scores=scores,
        loadings=loadings,
        biomarkers=biomarkers,
        correlations=correlations,
        figures=[],
        provenance=provenance,
    )


def _effective_seed(seed: int | None) -> int:
    """Devuelve la semilla pedida o genera una y la deja registrada."""
    if seed is not None:
        return seed
    return secrets.randbelow(2**63)


def _hash_archivo(path: Path) -> tuple[str, int]:
    """Calcula la huella SHA-256 de un archivo y su tamaño en bytes.

    La huella liga el resultado con el archivo **exacto** que entró al
    análisis: si el archivo cambia, la huella cambia (RB-7).
    """
    resumen = hashlib.sha256()
    total = 0

    try:
        with path.open("rb") as archivo:
            while True:
                trozo = archivo.read(TAMANO_HASH)
                if not trozo:
                    break
                resumen.update(trozo)
                total += len(trozo)
    except OSError as exc:
        raise PythomicsError(
            ErrorCode.E_UNEXPECTED,
            detail={"file": path.name, "reason": str(exc)},
        ) from exc

    return resumen.hexdigest(), total


def _data_fingerprint(blocks: list[_LoadedBlock]) -> list[DataFileFingerprint]:
    """Calcula la huella de cada archivo de datos de la receta.

    Se incluyen **todos** los bloques que entraron al trabajo, no solo los
    de variables: el archivo de metadatos también es parte de lo que define
    el resultado.
    """
    huellas: list[DataFileFingerprint] = []

    for block in blocks:
        sha256, size_bytes = _hash_archivo(Path(block.reference.path))
        huellas.append(
            DataFileFingerprint(
                name=block.reference.name,
                role=block.reference.role,
                sha256=sha256,
                size_bytes=size_bytes,
            )
        )

    return huellas


def _fingerprint_combinada(huellas: list[DataFileFingerprint]) -> str | None:
    """Resume la huella de todos los archivos en un solo valor.

    Es la forma rápida de comparar dos corridas: si el valor coincide, los
    archivos son los mismos.
    """
    if not huellas:
        return None

    resumen = hashlib.sha256()
    for huella in huellas:
        resumen.update(huella.name.encode("utf-8"))
        resumen.update(b"\0")
        resumen.update(huella.sha256.encode("ascii"))
        resumen.update(b"\n")

    return resumen.hexdigest()


def _slug_bloque(nombre: str) -> str:
    """Convierte el nombre de un bloque en un fragmento seguro de archivo.

    El nombre del bloque es el nombre del archivo (``nutrimouse_gene.csv``):
    se le quita la extensión y se reemplazan los caracteres que no son
    seguros en un nombre de archivo.
    """
    sin_extension = Path(nombre).stem
    limpio = re.sub(r"[^A-Za-z0-9_-]+", "_", sin_extension).strip("_")
    return limpio or "bloque"


def _nombre_figura(base: str, usados: set[str]) -> str:
    """Devuelve un nombre de figura que no se repita dentro del job."""
    nombre = base
    contador = 2

    while nombre in usados:
        nombre = f"{base}_{contador}"
        contador += 1

    usados.add(nombre)
    return nombre


def _dimensiones_png(ruta: Path) -> tuple[int, int] | None:
    """Lee el ancho y el alto de un PNG desde su cabecera IHDR.

    No hace falta abrir la imagen: los primeros 24 bytes del archivo llevan
    la firma y las dimensiones.
    """
    try:
        with ruta.open("rb") as archivo:
            cabecera = archivo.read(24)
    except OSError:
        return None

    if len(cabecera) < 24 or not cabecera.startswith(b"\x89PNG\r\n\x1a\n"):
        return None

    ancho = int.from_bytes(cabecera[16:20], "big")
    alto = int.from_bytes(cabecera[20:24], "big")
    return ancho, alto


def _metadata_figura(
    bloques: list[_LoadedBlock],
    target: TargetSpec | None,
    sample_ids: list[str],
) -> tuple[pd.DataFrame, str | None]:
    """Construye el DataFrame de metadatos del sample plot.

    Devuelve el DataFrame y el nombre de la columna con la que se colorea
    (``None`` cuando el análisis no es supervisado).

    El DataFrame tiene **siempre** una fila por muestra canónica: la
    biblioteca concatena el frame de metadatos con los scores del modelo, así
    que un número de filas distinto produce un gráfico con filas vacías.
    """
    indice = pd.Index(sample_ids, name="sample")

    if target is None:
        return pd.DataFrame(index=indice), None

    bloque = next(
        (
            candidate
            for candidate in bloques
            if candidate.reference.name == target.block
        ),
        None,
    )
    if bloque is None:
        raise PythomicsError(
            ErrorCode.E_TARGET_COLUMN_MISSING,
            detail={"block": target.block, "column": target.column},
        )

    valores = bloque.frame[target.column].to_numpy()

    return pd.DataFrame({target.column: valores}, index=indice), target.column


def _generar_sample_plot(
    modelo: _FittedModel,
    metadata: pd.DataFrame,
    hue: str | None,
    ruta: Path,
) -> Figure:
    """Genera el sample plot de un bloque y lo guarda como PNG.

    La importación de matplotlib y de la biblioteca de figuras es **local**:
    el proceso de la API no debe cargar ninguno de los dos.
    """
    try:
        import matplotlib

        # El worker no muestra nada en pantalla: el backend Agg dibuja sobre
        # un lienzo en memoria. Se fija antes de importar pyplot.
        matplotlib.use("Agg")

        import matplotlib.pyplot as plt

        from pythomics.visualizations import plot_pca
    except ImportError as exc:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "visualizations_not_available"},
        ) from exc

    figura, _ = plot_pca(
        modelo.estimator,
        metadata,
        hue=hue,
        title="PCA sample plot",
    )

    try:
        figura.savefig(ruta, format="png")
    finally:
        plt.close(figura)

    dimensiones = _dimensiones_png(ruta)

    return Figure(
        kind="pca",
        path=ruta.name,
        name=ruta.stem,
        mime="image/png",
        width=dimensiones[0] if dimensiones else None,
        height=dimensiones[1] if dimensiones else None,
    )


def _build_figures(
    fitted: list[_FittedModel],
    bloques: list[_LoadedBlock],
    target: TargetSpec | None,
    sample_ids: list[str],
    directorio: Path,
) -> list[Figure]:
    """Genera las figuras del análisis y las deja en el directorio del job.

    Se genera un sample plot por bloque de variables: cada bloque tiene su
    propio ajuste de PCA, así que cada uno tiene sus scores.

    El sample plot es **bidimensional**: con un solo componente no hay segundo
    eje que dibujar, así que en ese caso no se genera figura (queda avisado
    en el log del worker) y el resultado no se pierde.
    """
    if not fitted:
        return []

    metadata, hue = _metadata_figura(bloques, target, sample_ids)
    figuras: list[Figure] = []
    usados: set[str] = set()

    for modelo in fitted:
        componentes = int(modelo.estimator.variates_.shape[1])

        if componentes < 2:
            logger.warning(
                "El sample plot es bidimensional: con %d componente(s) no se "
                "genera la figura del bloque '%s'.",
                componentes,
                modelo.block_name,
            )
            continue

        nombre = _nombre_figura(
            f"{PREFIXO_FIGURA_SCORES}_{_slug_bloque(modelo.block_name)}",
            usados,
        )
        figuras.append(
            _generar_sample_plot(
                modelo,
                metadata,
                hue,
                directorio / f"{nombre}.png",
            )
        )

    return figuras


def _figura_biomarkers(fitted: _FittedDiablo, ruta: Path) -> Figure:
    """Dibuja el loading plot de los biomarcadores, un panel por bloque.

    La importación de matplotlib y de la biblioteca de figuras es **local**:
    el proceso de la API no debe cargar ninguno de los dos.
    """
    try:
        import matplotlib

        matplotlib.use("Agg")

        import matplotlib.pyplot as plt

        from pythomics.visualizations import plot_biomarkers
    except ImportError as exc:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "visualizations_not_available"},
        ) from exc

    figura, _ = plot_biomarkers(
        fitted.model,
        comp=1,
        title="Biomarker loadings",
    )

    try:
        figura.savefig(ruta, format="png")
    finally:
        plt.close(figura)

    dimensiones = _dimensiones_png(ruta)

    return Figure(
        kind="biomarkers",
        path=ruta.name,
        name=ruta.stem,
        mime="image/png",
        width=dimensiones[0] if dimensiones else None,
        height=dimensiones[1] if dimensiones else None,
    )


def _figura_circos(fitted: _FittedDiablo, ruta: Path) -> Figure:
    """Dibuja el círculo de correlaciones entre los bloques del DIABLO.

    El círculo usa la API de DIABLO/PLS de la biblioteca: los loadings, los
    nombres de las variables, las matrices de entrada y los variates del
    modelo. Por eso no sirve el sample plot del PCA.
    """
    try:
        import matplotlib

        matplotlib.use("Agg")

        import matplotlib.pyplot as plt

        from pythomics.visualizations import plot_circos
    except ImportError as exc:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "visualizations_not_available"},
        ) from exc

    colores = {
        clase: COLORES_CLASES[indice % len(COLORES_CLASES)]
        for indice, clase in enumerate(fitted.classes)
    }

    figura, _ = plot_circos(
        fitted.model,
        cutoff=0.5,
        components=(1, max(1, min(2, fitted.n_components))),
        group_colors=colores,
        title="Circos plot",
    )

    try:
        figura.savefig(ruta, format="png")
    finally:
        plt.close(figura)

    dimensiones = _dimensiones_png(ruta)

    return Figure(
        kind="circos",
        path=ruta.name,
        name=ruta.stem,
        mime="image/png",
        width=dimensiones[0] if dimensiones else None,
        height=dimensiones[1] if dimensiones else None,
    )


class _ModeloRecortado:
    """Vista de un modelo DIABLO limitada a sus variables más importantes.

    El heatmap (CIM) y la red de relevancia de la biblioteca se dibujan con
    **todas** las variables del modelo. Con un modelo real (breast.TCGA: 200
    variables de mRNA, 184 de miRNA y 142 de proteína) el heatmap tiene más
    de 500 columnas y la red es un enredo ilegible.

    Esta clase expone la misma superficie que usa la biblioteca
    (``X_dict_``, ``loadings_``, ``names_``, ``Y_``, ``get_biomarkers`` y
    ``transform``) pero recortada a las variables con mayor |loading| de
    cada bloque: las que el modelo seleccionó.

    Los nombres de variable se anteponen con el nombre del bloque cuando
    dos bloques comparten una variable (un gen y su proteína, por ejemplo):
    sin eso, la biblioteca renombra las columnas **después** de calcular
    los colores por bloque y los colores quedan desalineados.
    """

    def __init__(
        self,
        modelo: Any,
        n_variables: int,
        n_componentes: int,
    ) -> None:
        self._modelo = modelo
        self.Y_ = modelo.Y_
        self.X_dict_: dict[str, pd.DataFrame] = {}
        self.loadings_: dict[str, np.ndarray] = {}
        self.names_: dict[str, list[str]] = {}

        seleccion: dict[str, tuple[list[str], np.ndarray]] = {}
        for bloque, matriz in modelo.loadings_.items():
            matriz = np.asarray(matriz, dtype=float)
            if matriz.ndim != 2 or matriz.shape[0] == 0:
                continue

            nombres = [str(nombre) for nombre in modelo.names_.get(bloque, [])]
            if len(nombres) != matriz.shape[0]:
                # R y Python no deberían discrepar: si lo hacen, se dibuja
                # igual, pero con nombres posicionales y queda avisado.
                logger.warning(
                    "El bloque '%s' tiene %d loadings y %d nombres: se usan "
                    "nombres posicionales.",
                    bloque,
                    matriz.shape[0],
                    len(nombres),
                )
                nombres = [
                    f"var_{indice + 1}" for indice in range(matriz.shape[0])
                ]

            componentes = matriz[:, :n_componentes]
            # Se conservan las variables con mayor |loading| en algún
            # componente (las que el modelo seleccionó) y se ordenan por el
            # loading del primero: es el criterio del círculo de
            # correlaciones, así que las figuras cuentan la misma historia.
            importancia = np.max(np.abs(componentes), axis=1)
            indices = np.argsort(-importancia, kind="stable")[:n_variables]
            indices = indices[
                np.argsort(-componentes[indices, 0], kind="stable")
            ]

            marco = modelo.X_dict_.get(bloque)
            if marco is not None:
                # La biblioteca busca las columnas por nombre: si un
                # nombre no está en el dataframe, se descarta.
                disponibles = [
                    indice
                    for indice in indices
                    if nombres[indice] in marco.columns
                ]
                indices = np.array(disponibles, dtype=int)
                if indices.size == 0:
                    continue

            seleccion[bloque] = (
                [nombres[indice] for indice in indices],
                matriz[indices, :],
            )

        # Nombres repetidos entre bloques: se antepone el bloque.
        conteo: dict[str, int] = {}
        for nombres, _ in seleccion.values():
            for nombre in nombres:
                conteo[nombre] = conteo.get(nombre, 0) + 1

        for bloque, (nombres, matriz) in seleccion.items():
            renombrados = [
                f"{bloque}::{nombre}" if conteo[nombre] > 1 else nombre
                for nombre in nombres
            ]
            self.names_[bloque] = renombrados
            self.loadings_[bloque] = matriz

            marco = modelo.X_dict_.get(bloque)
            if marco is None:
                continue
            self.X_dict_[bloque] = marco[nombres].rename(
                columns=dict(zip(nombres, renombrados))
            )

    def get_biomarkers(self, block: str, comp: int = 1) -> pd.DataFrame:
        """Biomarcadores del bloque, con la forma que espera la biblioteca."""
        matriz = self.loadings_[block]
        nombres = np.array(self.names_[block], dtype=object)
        columna = min(max(int(comp), 1), matriz.shape[1]) - 1
        valores = matriz[:, columna]

        mascara = valores != 0
        valores = valores[mascara]
        nombres = nombres[mascara]

        orden = np.argsort(-np.abs(valores), kind="stable")
        marcadores = pd.DataFrame(
            {"value": valores[orden]},
            index=nombres[orden],
        )
        marcadores.index.name = "Variable"
        return marcadores

    def transform(self, x_dict: dict[str, pd.DataFrame]) -> dict[str, Any]:
        """Variates del modelo original (la red de relevancia los usa)."""
        return self._modelo.transform(x_dict)


def _modelo_recortado(
    modelo: Any,
    n_variables: int,
    n_componentes: int,
) -> _ModeloRecortado | None:
    """Arma la vista recortada del modelo para las figuras del DIABLO.

    ``None`` cuando el modelo no tiene variables que dibujar: no hay
    figura que hacer y el job sigue sin ella.
    """
    loadings = getattr(modelo, "loadings_", None) or {}
    if not loadings:
        return None

    recortado = _ModeloRecortado(modelo, n_variables, n_componentes)
    if not recortado.loadings_:
        return None

    return recortado


def _colores_de_clases(fitted: _FittedDiablo) -> dict[str, str]:
    """Un color por clase del análisis, para colorear filas o grupos."""
    return {
        clase: COLORES_CLASES[indice % len(COLORES_CLASES)]
        for indice, clase in enumerate(fitted.classes)
    }


def _colores_de_bloques(fitted: _FittedDiablo) -> dict[str, str]:
    """Un color por bloque, para colorear columnas o nodos."""
    return {
        bloque: COLORES_BLOQUES[indice % len(COLORES_BLOQUES)]
        for indice, bloque in enumerate(fitted.blocks)
    }


def _figura_heatmap(fitted: _FittedDiablo, ruta: Path) -> Figure | None:
    """Dibuja el heatmap clusterizado (CIM) del DIABLO.

    El CIM es el **Clustered Image Map** de la biblioteca: las muestras en
    las filas (coloreadas por clase), las variables en las columnas
    (coloreadas por bloque) y el valor de la variable como color, con los
    dos dendrogramas de la jerarquía. Es la figura que muestra qué
    muestras se parecen entre sí y qué variables las separan.

    La biblioteca dibuja **todas** las variables del modelo: con un modelo
    real eso son cientos de columnas y el mapa no se lee. Por eso la
    figura se dibuja sobre un modelo recortado a las
    :data:`VARIABLES_POR_BLOQUE_FIGURAS` variables más importantes de cada
    bloque.

    Devuelve ``None`` cuando no hay nada que dibujar: el job no se pierde
    por una figura.
    """
    try:
        import matplotlib

        matplotlib.use("Agg")

        import matplotlib.pyplot as plt

        from pythomics.visualizations import plot_cim
    except ImportError as exc:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "visualizations_not_available"},
        ) from exc

    modelo = _modelo_recortado(
        fitted.model,
        VARIABLES_POR_BLOQUE_FIGURAS,
        fitted.n_components,
    )
    if modelo is None:
        logger.warning(
            "El heatmap no se dibuja: el modelo no devolvió loadings por "
            "bloque."
        )
        return None

    componentes = (1, max(1, min(2, fitted.n_components)))

    muestras = 0
    for bloque in fitted.blocks:
        marco = modelo.X_dict_.get(bloque)
        if marco is not None:
            muestras = max(muestras, len(marco.index))

    grilla = plot_cim(
        modelo,
        components=componentes,
        block_colors=_colores_de_bloques(fitted),
        group_colors=_colores_de_clases(fitted),
        # Cada bloque tiene su escala (un z-score por columna): sin esto,
        # el bloque con más valores dominaría el color de todos.
        standardize=True,
        show_var_names=True,
        # Con muchas muestras los identificadores se superponen: el color
        # de la fila ya dice de qué clase es cada muestra.
        show_sample_names=muestras <= UMBRAL_NOMBRES_MUESTRA_HEATMAP,
        title="CIM - clustered heatmap",
        figsize=(14, 10),
        cmap="Spectral_r",
    )

    try:
        grilla.figure.savefig(ruta, format="png")
    finally:
        plt.close(grilla.figure)

    dimensiones = _dimensiones_png(ruta)

    return Figure(
        kind="heatmap",
        path=ruta.name,
        name=ruta.stem,
        mime="image/png",
        width=dimensiones[0] if dimensiones else None,
        height=dimensiones[1] if dimensiones else None,
    )


def _margen_para_leyendas(eje: Any) -> None:
    """Abre un margen en el eje para que las leyendas no tapen los nodos.

    La biblioteca de la red de relevancia pone las leyendas en las esquinas
    del eje y los nodos ocupan toda la caja: sin margen, una leyenda queda
    encima de un nodo.
    """
    x_min, x_max = eje.get_xlim()
    y_min, y_max = eje.get_ylim()
    ancho = x_max - x_min
    alto = y_max - y_min

    eje.set_xlim(x_min - 0.22 * ancho, x_max + 0.08 * ancho)
    eje.set_ylim(y_min - 0.18 * alto, y_max + 0.08 * alto)


def _figura_network(fitted: _FittedDiablo, ruta: Path) -> Figure | None:
    """Dibuja la red de relevancia entre los bloques del DIABLO.

    La red usa ``plot_network`` de la biblioteca: cruza las variables de
    bloques distintos según su correlación con los variates, y descarta las
    variables que no están conectadas con nadie.

    La biblioteca no acepta un corte que venga del usuario: se prueban los
    cortes de :data:`CORTES_RELEVANCE`, del más estricto al más laxo, y el
    que se usó queda escrito en el título de la figura. Si ningún par de
    variables llega al corte más laxo, no hay red que dibujar y la figura se
    omite (el job no se pierde por eso).
    """
    try:
        import matplotlib

        matplotlib.use("Agg")

        import matplotlib.pyplot as plt

        from pythomics.visualizations import plot_network
    except ImportError as exc:
        raise PythomicsError(
            ErrorCode.E_ANALYSIS_FAILED,
            detail={"reason": "visualizations_not_available"},
        ) from exc

    colores = _colores_de_bloques(fitted)

    modelo = _modelo_recortado(
        fitted.model,
        VARIABLES_POR_BLOQUE_FIGURAS,
        fitted.n_components,
    )
    if modelo is None:
        logger.warning(
            "La red de relevancia no se dibuja: el modelo no devolvió "
            "loadings por bloque."
        )
        return None

    for corte in CORTES_RELEVANCE:
        try:
            figura, eje = plot_network(
                modelo,
                cutoff=corte,
                components=(1, max(1, min(2, fitted.n_components))),
                block_colors=colores,
                title=f"Relevance network (|r| >= {corte})",
                figsize=(14, 9),
            )
        except ValueError as exc:
            # La biblioteca lanza ValueError cuando ninguna correlación
            # llega al corte: se afloja y se vuelve a intentar.
            logger.info(
                "La red de relevancia no llegó al corte %s: %s",
                corte,
                exc,
            )
            continue

        # La biblioteca dibuja las leyendas en las esquinas del eje y los
        # nodos llegan hasta el borde: se abre un margen para que una
        # leyenda no tape un nodo.
        _margen_para_leyendas(eje)

        try:
            figura.savefig(ruta, format="png")
        finally:
            plt.close(figura)

        dimensiones = _dimensiones_png(ruta)

        return Figure(
            kind="network",
            path=ruta.name,
            name=ruta.stem,
            mime="image/png",
            width=dimensiones[0] if dimensiones else None,
            height=dimensiones[1] if dimensiones else None,
        )

    logger.warning(
        "La red de relevancia no se dibuja: ninguna correlación entre "
        "variables de bloques distintos llegó al corte %s.",
        CORTES_RELEVANCE[-1],
    )
    return None


def _figura_con_respaldo(
    nombre: str,
    dibujar: Callable[[_FittedDiablo, Path], Figure | None],
    fitted: _FittedDiablo,
    ruta: Path,
) -> Figure | None:
    """Dibuja una figura sin tumbar el job si falla.

    El job ya tiene resultados válidos: perder una figura es preferible a
    perder el análisis. El motivo del fallo queda en el log del worker.
    """
    try:
        return dibujar(fitted, ruta)
    except Exception as exc:  # noqa: BLE001 - degradar, no tumbar el job
        logger.warning(
            "No se pudo dibujar la figura '%s': %s. El job sigue sin ella.",
            nombre,
            exc,
            exc_info=True,
        )
        return None


def _build_diablo_figures(fitted: _FittedDiablo, directorio: Path) -> list[Figure]:
    """Genera las figuras del DIABLO y las deja en el directorio del job.

    Son cuatro: el **loading plot** (las variables con mayor |loading| por
    bloque), el **heatmap clusterizado** (las muestras agrupadas por
    jerarquía, con las variables más importantes de cada bloque), la **red
    de relevancia** (qué variables de un bloque se relacionan con las de
    otro) y el **círculo de correlaciones** (la relación entre las
    variables seleccionadas de cada bloque).

    Ninguna figura puede tumbar el job: si una falla (falta una
    dependencia, R devuelve un error, se queda sin memoria), se deja
    aviso en el log y el trabajo sigue con las demás. El heatmap y la red
    además pueden faltar sin error: cuando el modelo no tiene datos para
    dibujarlos.
    """
    if not fitted.blocks:
        return []

    dibujadores = (
        (NOMBRE_FIGURA_BIOMARKERS, _figura_biomarkers),
        (NOMBRE_FIGURA_HEATMAP, _figura_heatmap),
        (NOMBRE_FIGURA_NETWORK, _figura_network),
        (NOMBRE_FIGURA_CIRCOS, _figura_circos),
    )

    figuras: list[Figure] = []
    for nombre, dibujar in dibujadores:
        figura = _figura_con_respaldo(
            nombre,
            dibujar,
            fitted,
            directorio / f"{nombre}.png",
        )
        if figura is not None:
            figuras.append(figura)

    return figuras


def _build_result(
    fitted: list[_FittedModel],
    *,
    n_components: int,
    seed: int | None,
    bloques: list[_LoadedBlock] | None = None,
    target: TargetSpec | None = None,
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
    bloques = bloques or []
    huellas = _data_fingerprint(bloques)
    provenance = Provenance(
        pythomics_version=_pythomics_version(),
        seed=effective_seed,
        params={
            "model_type": "PCA",
            "estimator": "NipalsPCA",
            "center": True,
            "scale": False,
            "n_components": n_components,
            "preprocessing": [],
            "blocks": [model.block_name for model in fitted],
            "target": (
                {"block": target.block, "column": target.column}
                if target is not None
                else None
            ),
        },
        preprocessing=[],
        data_files=huellas,
        data_fingerprint=_fingerprint_combinada(huellas),
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
    sample_ids = list(spec.alignment.sample_ids)
    _validate_target(loaded, spec.target)
    aligned = _align_blocks(loaded, sample_ids)

    _write_progress(progress_path, "preprocess")
    # RF-3 queda fuera del MVP: esta etapa deja constancia y no transforma.

    _write_progress(progress_path, "fit")
    if spec.model.model_type == "DIABLO":
        ajustado = _fit_diablo(
            aligned,
            spec.target,
            n_components=spec.model.n_components,
            design=spec.model.design,
            keepX=spec.model.keepX,
            seed=spec.model.seed,
        )

        _write_progress(progress_path, "transform")
        result = _resultado_diablo(
            ajustado,
            n_components=spec.model.n_components,
            bloques=aligned,
            target=spec.target,
        )

        _write_progress(progress_path, "figures")
        result.figures = _build_diablo_figures(ajustado, result_path.parent)
    else:
        fitted = _fit_pca(aligned, spec.model.n_components)

        _write_progress(progress_path, "transform")
        result = _build_result(
            fitted,
            n_components=spec.model.n_components,
            seed=spec.model.seed,
            bloques=aligned,
            target=spec.target,
        )

        _write_progress(progress_path, "figures")
        result.figures = _build_figures(
            fitted,
            aligned,
            spec.target,
            sample_ids,
            result_path.parent,
        )

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
