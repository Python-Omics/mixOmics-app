"""Esquemas Pydantic v2 del backend de Pythomics.

Este módulo define el contrato de datos entre la API local (FastAPI) y el
renderer de la app de escritorio (Electron). Reglas del contrato:

* La sesión de datos es una **receta**, no las matrices (S29). El backend
  guarda rutas, forma e IDs de muestra; las matrices crudas nunca viajan
  (RB-9, RNF-S-3).
* Los modelos de request son estrictos (``extra="forbid"``): un campo
  desconocido es un error de validación, nunca un ignore silencioso.
* Los modelos de response aceptan campos adicionales (``extra="ignore"``)
  para que el worker pueda sumar información sin romper el contrato.
* Todo campo expuesto es JSON-serializable (H4): la whitelist de
  serialización excluye, entre otros, ``r_fit_``.
* Los errores no se traducen aquí: viajan como ``code`` + ``message_key``
  (S22, S28) y el renderer los formatea con ICU.

La nomenclatura científica (PCA, DIABLO, keepX, mixOmics) va en inglés; los
comentarios y docstrings van en español neutro.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ------------------------------------------------------------------------------
# Piezas sueltas del resultado
# ------------------------------------------------------------------------------


class VariableLoading(BaseModel):
    """Carga de una variable en un componente del modelo."""

    model_config = ConfigDict(extra="ignore")

    variable_id: str = Field(
        ...,
        description=(
            "Identificador de la variable (nombre de la columna dentro del bloque)."
        ),
    )
    loading: float = Field(
        ...,
        description="Peso (loading) de la variable en el componente.",
    )
    component: int = Field(
        ...,
        description=(
            "Componente al que pertenece la variable "
            "(numeración 1-based, como en mixOmics)."
        ),
    )


class Biomarker(BaseModel):
    """Biomarcador seleccionado por el modelo, con su estabilidad."""

    model_config = ConfigDict(extra="ignore")

    variable_id: str = Field(
        ...,
        description="Identificador de la variable candidata a biomarcador.",
    )
    loading: float = Field(
        ...,
        description="Peso (loading) de la variable en el componente.",
    )
    stability: float | None = Field(
        default=None,
        description=(
            "Estabilidad bootstrap de la variable (0-1). "
            "None cuando el modelo no reporta estabilidad."
        ),
    )
    component: int = Field(
        ...,
        description="Componente al que pertenece la variable (numeración 1-based).",
    )
    block: str = Field(
        ...,
        description="Nombre del bloque al que pertenece la variable.",
    )


class Figure(BaseModel):
    """Figura generada por el análisis (PNG dentro del directorio del job)."""

    model_config = ConfigDict(extra="ignore")

    kind: str = Field(
        ...,
        description=(
            "Tipo de figura: 'pca', 'cim', 'circos', 'biomarkers', etc. "
            "El renderer decide cómo presentarla a partir de este valor."
        ),
    )
    path: str = Field(
        ...,
        description="Ruta de la figura relativa al directorio del job.",
    )
    name: str = Field(
        ...,
        description="Nombre del archivo de la figura (sin directorio).",
    )
    mime: str = Field(
        default="image/png",
        description="Tipo MIME de la figura.",
    )
    width: int | None = Field(
        default=None,
        description="Ancho en píxeles, si se conoce.",
    )
    height: int | None = Field(
        default=None,
        description="Alto en píxeles, si se conoce.",
    )


# ------------------------------------------------------------------------------
# Progreso, errores y metadatos de la API
# ------------------------------------------------------------------------------


class Progress(BaseModel):
    """Progreso del job por etapa, sin porcentaje (S13, §5.7)."""

    model_config = ConfigDict(extra="ignore")

    stage: Literal[
        "queued", "load", "align", "preprocess", "fit", "transform", "figures"
    ] = Field(
        ...,
        description="Etapa actual del pipeline. La barra de la UI es indeterminada.",
    )
    index: int = Field(
        ...,
        description="Índice de la etapa actual, base 0 (load=0 ... figures=5).",
    )
    total: int = Field(
        default=6,
        description="Cantidad total de etapas del pipeline.",
    )


class ApiError(BaseModel):
    """Error estructurado del backend: código, clave de i18n y detalle."""

    model_config = ConfigDict(extra="ignore")

    code: str = Field(
        ...,
        description="Código de error canónico (E_*). El renderer decide el texto.",
    )
    message_key: str = Field(
        ...,
        description=(
            "Clave i18n que el renderer resuelve (errors.<camelCaseDelCodigo>)."
        ),
    )
    detail: dict[str, Any] = Field(
        default_factory=dict,
        description="Datos estructurados del error (archivo, IDs duplicados, etc.).",
    )


class ErrorEnvelope(BaseModel):
    """Sobre de error que el backend devuelve en toda respuesta no exitosa."""

    model_config = ConfigDict(extra="ignore")

    error: ApiError = Field(
        ...,
        description="Error estructurado con code, message_key y detail.",
    )


class Capabilities(BaseModel):
    """Qué puede hacer el backend en esta máquina (S26)."""

    model_config = ConfigDict(extra="ignore")

    pythomics: bool = Field(
        ...,
        description="Si la librería pythomics está instalada y es importable.",
    )
    r: bool = Field(
        ...,
        description="Si R está disponible a través de rpy2.",
    )
    mixomics: bool = Field(
        ...,
        description="Si el paquete mixOmics de R está disponible.",
    )
    models: list[str] = Field(
        default_factory=lambda: ["PCA", "DIABLO"],
        description=(
            "Modelos que acepta el contrato (S31). Que DIABLO pueda "
            "ejecutarse además depende de 'r' y 'mixomics': la UI deshabilita "
            "lo que el entorno no soporta."
        ),
    )


class Health(BaseModel):
    """Estado del backend y capacidades del entorno."""

    model_config = ConfigDict(extra="ignore")

    status: str = Field(
        ...,
        description="Estado global del backend ('ok' cuando responde).",
    )
    version: str = Field(
        ...,
        description="Versión de la app/backend.",
    )
    data_dir: str = Field(
        ...,
        description="Ruta del directorio de datos del backend.",
    )
    capabilities: Capabilities = Field(
        ...,
        description="Capacidades disponibles en esta máquina.",
    )


# ------------------------------------------------------------------------------
# Archivos (compatibles con frontend/src/lib/types.ts)
# ------------------------------------------------------------------------------


class FilesResponse(BaseModel):
    """Listado de archivos cargados en el backend."""

    model_config = ConfigDict(extra="ignore")

    archivos: list[str] = Field(
        default_factory=list,
        description="Nombres de los archivos disponibles en el directorio de datos.",
    )
    total: int = Field(
        default=0,
        description="Cantidad de archivos listados.",
    )
    ruta: str = Field(
        default="",
        description="Ruta del directorio de datos donde viven los archivos.",
    )


class UploadResponse(BaseModel):
    """Confirmación de una carga de archivo."""

    model_config = ConfigDict(extra="ignore")

    mensaje: str = Field(
        ...,
        description="Mensaje de confirmación de la carga.",
    )
    nombre: str = Field(
        ...,
        description="Nombre del archivo guardado en el backend.",
    )


class DeleteResponse(BaseModel):
    """Confirmación de un borrado de archivo."""

    model_config = ConfigDict(extra="ignore")

    mensaje: str = Field(
        ...,
        description="Mensaje de confirmación del borrado.",
    )


# ------------------------------------------------------------------------------
# Sesión de datos (la receta, nunca las matrices)
# ------------------------------------------------------------------------------


class BlockRef(BaseModel):
    """Referencia a un bloque de datos: nombre, ruta y forma."""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(
        ...,
        description=(
            "Nombre del archivo del bloque (por ejemplo 'nutrimouse_gene.csv')."
        ),
    )
    path: str = Field(
        ...,
        description="Ruta del archivo en el disco del backend.",
    )
    n_samples: int = Field(
        ...,
        description="Cantidad de muestras (filas) del bloque.",
    )
    n_variables: int = Field(
        ...,
        description="Cantidad de variables (columnas numéricas) del bloque.",
    )
    sample_ids: list[str] = Field(
        default_factory=list,
        description="IDs de muestra leídos de la primera columna, en orden.",
    )


class Alignment(BaseModel):
    """Decisión de alineación entre bloques, por ID y no por posición (RB-3)."""

    model_config = ConfigDict(extra="ignore")

    sample_ids: list[str] = Field(
        default_factory=list,
        description=(
            "IDs de muestra supervivientes, en orden "
            "(el orden es parte del contrato)."
        ),
    )
    discarded: dict[str, list[str]] = Field(
        default_factory=dict,
        description="IDs descartados por bloque.",
    )
    confirmed: bool = Field(
        default=False,
        description="Si el usuario confirmó la alineación.",
    )


class PreprocessingStep(BaseModel):
    """Paso de preprocesamiento de la receta (RF-3)."""

    model_config = ConfigDict(extra="ignore")

    op: Literal["center", "scale", "impute", "filter_zero_var"] = Field(
        ...,
        description="Operación del paso.",
    )
    params: dict[str, object] = Field(
        default_factory=dict,
        description="Parámetros de la operación (valores JSON-serializables).",
    )
    applied_at: str | None = Field(
        default=None,
        description="Marca de tiempo ISO 8601 de aplicación del paso, si ya se aplicó.",
    )


class PreprocessResult(BaseModel):
    """Resultado de registrar el preprocesamiento de un dataset (RF-3).

    El endpoint **no** preprocesa: registra la receta. El worker la aplica
    al ejecutar el modelo (S29).
    """

    model_config = ConfigDict(extra="ignore")

    dataset_id: str = Field(
        ...,
        description="Dataset al que se le registró el preprocesamiento.",
    )
    steps: list[PreprocessingStep] = Field(
        default_factory=list,
        description="Pasos registrados, en el orden en que se van a aplicar.",
    )
    confirmed: bool = Field(
        default=False,
        description="Si el usuario confirmó explícitamente los pasos.",
    )


class TargetSpec(BaseModel):
    """Variable de clase: bloque de origen + columna."""

    model_config = ConfigDict(extra="forbid")

    block: str = Field(
        ...,
        description="Nombre del bloque que aporta la variable de clase.",
    )
    column: str = Field(
        ...,
        description="Columna dentro del bloque con la variable de clase.",
    )


class Dataset(BaseModel):
    """Sesión de datos del backend: la receta, nunca las matrices (S29)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(
        ...,
        description="Identificador de la sesión de datos.",
    )
    blocks: list[BlockRef] = Field(
        default_factory=list,
        description="Bloques que entran en el análisis.",
    )
    alignment: Alignment | None = Field(
        default=None,
        description="Alineación decidida entre los bloques, si ya se calculó.",
    )
    preprocessing: list[PreprocessingStep] = Field(
        default_factory=list,
        description="Receta de preprocesamiento a aplicar en el worker.",
    )
    target: TargetSpec | None = Field(
        default=None,
        description="Variable de clase, si el análisis es supervisado.",
    )


# ------------------------------------------------------------------------------
# Solicitud de modelo
# ------------------------------------------------------------------------------


class ModelRequest(BaseModel):
    """Solicitud de ejecución de un modelo (RF-4 PCA / RF-8 DIABLO)."""

    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(
        ...,
        description=(
            "ID de la sesión de datos (Dataset.id) sobre la que se ejecuta el modelo."
        ),
    )
    model_type: Literal["PCA", "DIABLO"] = Field(
        ...,
        description=(
            "Modelo a ejecutar. sPLS-DA está diferido (S6) y no forma parte "
            "de este contrato."
        ),
    )
    n_components: int = Field(
        default=2,
        ge=1,
        le=10,
        description="Cantidad de componentes a ajustar.",
    )
    keepX: dict[str, list[int]] | None = Field(
        default=None,
        description="Variables a conservar por bloque, con la convención de mixOmics.",
    )
    design: list[list[float]] | None = Field(
        default=None,
        description=(
            "Matriz de diseño p×p de DIABLO. Si no viene, el worker usa el "
            "default de mixOmics."
        ),
    )
    target: TargetSpec | None = Field(
        default=None,
        description="Variable de clase (bloque + columna) para modelos supervisados.",
    )
    seed: int | None = Field(
        default=None,
        description=(
            "Semilla aleatoria (RB-6). Si no viene, el worker genera una y "
            "la registra en la provenance."
        ),
    )


# ------------------------------------------------------------------------------
# Resultado y trazabilidad
# ------------------------------------------------------------------------------


class Provenance(BaseModel):
    """Trazabilidad del análisis (RB-7): versiones, semilla, parámetros y receta."""

    model_config = ConfigDict(extra="ignore")

    pythomics_version: str = Field(
        ...,
        description="Versión de pythomics (importlib.metadata.version('pythomics')).",
    )
    r_version: str | None = Field(
        default=None,
        description="Versión de R usada, si el análisis corrió en R.",
    )
    mixomics_version: str | None = Field(
        default=None,
        description="Versión del paquete mixOmics de R, si estuvo disponible.",
    )
    seed: int = Field(
        ...,
        description="Semilla efectiva del análisis (RB-6): la pedida o la generada.",
    )
    params: dict[str, object] = Field(
        default_factory=dict,
        description="Parámetros efectivos del modelo (valores JSON-serializables).",
    )
    preprocessing: list[PreprocessingStep] = Field(
        default_factory=list,
        description="Receta de preprocesamiento efectivamente aplicada.",
    )
    created_at: str = Field(
        ...,
        description="Marca de tiempo ISO 8601 de creación del reporte.",
    )


class ModelResult(BaseModel):
    """Resultado del análisis, con whitelist de serialización (H4)."""

    model_config = ConfigDict(extra="ignore")

    model_type: str = Field(
        ...,
        description="Modelo ejecutado.",
    )
    blocks: list[str] = Field(
        default_factory=list,
        description="Nombres de los bloques que participaron del análisis.",
    )
    n_components: int = Field(
        ...,
        description="Cantidad de componentes ajustados.",
    )
    explained_variance_ratio: list[float] | None = Field(
        default=None,
        description="Varianza explicada por componente, si el modelo la reporta.",
    )
    scores: dict[str, list[list[float]]] = Field(
        default_factory=dict,
        description=(
            "Scores por bloque: filas = muestras, columnas = componentes."
        ),
    )
    loadings: dict[str, list[VariableLoading]] = Field(
        default_factory=dict,
        description="Loadings por bloque.",
    )
    biomarkers: list[Biomarker] = Field(
        default_factory=list,
        description="Biomarcadores seleccionados, con su estabilidad.",
    )
    correlations: dict[str, list[list[float]]] = Field(
        default_factory=dict,
        description="Matrices de correlación entre bloques, indexadas por par.",
    )
    figures: list[Figure] = Field(
        default_factory=list,
        description="Figuras generadas, con su ruta dentro del directorio del job.",
    )
    provenance: Provenance = Field(
        ...,
        description="Trazabilidad del análisis (RB-7).",
    )


class Job(BaseModel):
    """Estado de un job de análisis asíncrono (S4, S23)."""

    model_config = ConfigDict(extra="ignore")

    job_id: str = Field(
        ...,
        description="Identificador del job.",
    )
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"] = Field(
        ...,
        description="Estado del job.",
    )
    progress: Progress | None = Field(
        default=None,
        description="Progreso por etapa, mientras el job está en curso.",
    )
    result: ModelResult | None = Field(
        default=None,
        description="Resultado del análisis, si el job terminó con éxito.",
    )
    error: ApiError | None = Field(
        default=None,
        description="Error estructurado, si el job falló.",
    )
