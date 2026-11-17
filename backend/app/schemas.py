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

    kind: Literal[
        "pca", "biomarkers", "circos", "heatmap", "network"
    ] = Field(
        ...,
        description=(
            "Tipo de figura. 'pca' es el sample plot del PCA; 'biomarkers' "
            "es el loading plot y 'circos' el círculo de correlaciones del "
            "DIABLO; 'heatmap' es el heatmap clusterizado (CIM) y 'network' "
            "la red de relevancia del DIABLO. El renderer decide cómo "
            "presentarla a partir de este valor."
        ),
    )
    path: str = Field(
        ...,
        description=(
            "Ruta de la figura relativa al directorio del job "
            "(por ejemplo 'scores_gene.png')."
        ),
    )
    name: str = Field(
        ...,
        description=(
            "Nombre de la figura, sin directorio ni extensión "
            "(por ejemplo 'scores_gene'). Es el nombre que se pide en "
            "GET /v1/files/{job_id}/{name}.png."
        ),
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
# Archivos e ingesta (compatibles con frontend/src/lib/types.ts)
# ------------------------------------------------------------------------------


class IngestWarning(BaseModel):
    """Aviso no bloqueante detectado durante la ingesta de un bloque."""

    model_config = ConfigDict(extra="ignore")

    code: str = Field(
        ...,
        description="Código canónico del aviso (W_*).",
    )
    message_key: str = Field(
        ...,
        description=(
            "Clave i18n que el renderer resuelve "
            "(ingest.warnings.<camelCaseDelCodigo>)."
        ),
    )
    columns: list[str] = Field(
        default_factory=list,
        description="Columnas afectadas por el aviso, cuando corresponde.",
    )
    detail: dict[str, Any] = Field(
        default_factory=dict,
        description="Datos estructurados del aviso.",
    )


class BlockSummary(BaseModel):
    """Resumen de un bloque ingerido que vuelve al renderer.

    Es distinto de :class:`BlockRef`: la referencia pertenece a la receta
    interna e incluye la ruta y todos los IDs de muestra, pero no lleva la
    clasificación de columnas. Este resumen incluye esa clasificación y no
    incluye los IDs, porque una matriz puede tener decenas de miles de
    muestras y la respuesta debe permanecer ligera.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = Field(
        ...,
        description="Nombre del bloque, derivado del nombre del archivo sin extensión.",
    )
    filename: str = Field(
        ...,
        description="Nombre seguro del archivo ingerido.",
    )
    n_samples: int = Field(
        ...,
        description="Cantidad de muestras (filas) del bloque.",
    )
    n_variables: int = Field(
        ...,
        description=(
            "Cantidad total de variables (columnas sin el ID de muestra) "
            "del bloque."
        ),
    )
    n_numeric_variables: int = Field(
        ...,
        description="Cantidad de variables del bloque que son numéricas por dtype.",
    )
    columns: list[str] = Field(
        default_factory=list,
        description=(
            "Nombres de hasta 100 columnas de variables, en orden. "
            "El total completo se obtiene de n_variables."
        ),
    )
    sample_id_column: str = Field(
        ...,
        description="Nombre de la primera columna, que contiene los IDs de muestra.",
    )


class PreviewData(BaseModel):
    """Vista previa acotada de un bloque ingerido."""

    model_config = ConfigDict(extra="ignore")

    columns: list[str] = Field(
        ...,
        description="Nombres de las columnas incluidas en la vista previa.",
    )
    rows: list[list[str]] = Field(
        ...,
        description="Filas de la vista previa, con todos los valores como texto.",
    )


class IngestResponse(BaseModel):
    """Respuesta de la ingesta validada de un bloque de datos."""

    model_config = ConfigDict(extra="ignore")

    block: BlockSummary = Field(
        ...,
        description="Resumen del bloque ingerido.",
    )
    warnings: list[IngestWarning] = Field(
        default_factory=list,
        description="Avisos no bloqueantes detectados durante la validación.",
    )
    preview: PreviewData = Field(
        ...,
        description="Vista previa acotada del bloque.",
    )


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
    """Referencia interna a un bloque de datos dentro de la receta.

    La receta es **autosuficiente**: el worker no necesita reinterpretar el
    archivo para saber qué columnas son numéricas y cuáles categóricas.

    La clasificación se guarda **por excepciones**: se listan las columnas
    categóricas y el resto se deduce de ``n_variables`` y
    ``n_numeric_variables``. Un bloque de 2308 variables numéricas no
    arrastra 2308 nombres en cada receta.

    ``role`` declara si el bloque aporta variables al modelo (``block``) o
    es una tabla de anotaciones (``metadata``). Lo declara el origen del
    archivo, no el dtype: con la codificación entera de mixOmics una tabla
    de phenotypes también tiene columnas numéricas.

    El resumen que vuelve al renderer tras la ingesta usa
    :class:`BlockSummary` y no transporta la lista de IDs.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = Field(
        ...,
        description=(
            "Nombre del archivo del bloque (por ejemplo 'nutrimouse_gene.csv')."
        ),
    )
    role: Literal["block", "metadata"] = Field(
        default="block",
        description=(
            "Rol del bloque: 'block' aporta variables al modelo, "
            "'metadata' es una tabla de anotaciones (fenotipo)."
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
        description="Cantidad de variables (columnas) del bloque.",
    )
    n_numeric_variables: int = Field(
        ...,
        description="Cantidad de variables numéricas del bloque, por dtype.",
    )
    categorical_columns: list[str] = Field(
        default_factory=list,
        description=(
            "Columnas que NO son numéricas. Lista completa: las variables "
            "numéricas se deducen por diferencia con n_variables."
        ),
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


class AlignmentRequest(BaseModel):
    """Solicitud de alineación entre bloques (RF-2, RB-3).

    El cliente manda los **nombres** de los bloques a alinear, en orden: el
    primero es el que fija el orden canónico de las muestras. La alineación
    se calcula desde la receta (los IDs de muestra ya están ahí), sin abrir
    ni materializar ninguna matriz (S29).
    """

    model_config = ConfigDict(extra="forbid")

    blocks: list[str] = Field(
        ...,
        min_length=1,
        description="Nombres de los bloques a alinear, en orden.",
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


class DatasetSummary(BaseModel):
    """Resumen de una receta, para listarlas sin arrastrar los bloques."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Identificador de la sesión de datos.")
    n_blocks: int = Field(..., description="Cantidad de bloques de la receta.")
    target: TargetSpec | None = Field(
        default=None,
        description="Variable de clase, si la receta ya la tiene.",
    )


class DatasetListResponse(BaseModel):
    """Listado de las recetas guardadas."""

    model_config = ConfigDict(extra="ignore")

    datasets: list[DatasetSummary] = Field(default_factory=list)
    total: int = Field(default=0)


class DatasetBlockInput(BaseModel):
    """Bloque solicitado para una receta: el archivo y el rol que tiene.

    El cliente manda **el nombre**, nunca la ruta: el backend resuelve la
    ruta dentro de su propio directorio de datos, así que el renderer no
    puede pedirle que lea un archivo de cualquier parte del disco.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        ...,
        description="Nombre del archivo subido que compone la receta.",
    )
    role: Literal["block", "metadata"] = Field(
        default="block",
        description=(
            "Rol del bloque: 'block' aporta variables al modelo, "
            "'metadata' es una tabla de anotaciones (fenotipo)."
        ),
    )


class DatasetCreate(BaseModel):
    """Alta de una receta de dataset: qué archivos la componen."""

    model_config = ConfigDict(extra="forbid")

    blocks: list[DatasetBlockInput] = Field(
        ...,
        min_length=1,
        description="Bloques que componen el dataset, en orden.",
    )
    target: TargetSpec | None = Field(
        default=None,
        description=(
            "Variable de clase (bloque + columna). Si no viene, se puede "
            "fijar más adelante; en ese caso la receta no es supervisada."
        ),
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
        description=(
            "Variables a conservar por bloque, con la convención de mixOmics: "
            "una lista por bloque con un valor por componente. El worker "
            "exige que la lista tenga tantos elementos como componentes."
        ),
    )
    design: list[list[float]] | None = Field(
        default=None,
        description=(
            "Matriz de diseño p×p de DIABLO. Si no viene, el worker usa el "
            "default de mixOmics (ceros en la diagonal y unos en el resto) "
            "y lo registra en la provenance."
        ),
    )
    target: TargetSpec | None = Field(
        default=None,
        description=(
            "Variable de clase (bloque + columna) para modelos supervisados. "
            "El DIABLO la exige: sin ella la solicitud se rechaza con "
            "E_TARGET_COLUMN_MISSING."
        ),
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


class DataFileFingerprint(BaseModel):
    """Identidad de un archivo de datos que entró al análisis (RB-7).

    La huella liga el resultado con el archivo **exacto** que se usó: si el
    archivo cambia en disco, la huella cambia y se nota que el resultado es
    de otra corrida.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = Field(
        ...,
        description="Nombre del archivo de datos (por ejemplo 'nutrimouse_gene.csv').",
    )
    role: str = Field(
        default="block",
        description="Rol del bloque: 'block' (variables) o 'metadata' (anotaciones).",
    )
    sha256: str = Field(
        ...,
        description="Huella SHA-256 del contenido del archivo.",
    )
    size_bytes: int = Field(
        ...,
        description="Tamaño del archivo en bytes.",
    )


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
    peak_rss_mb: float | None = Field(
        default=None,
        description=(
            "Pico de memoria residente del proceso que corrió el análisis, "
            "en MB (RNF-R-3: RAM pico durante análisis ≤ 4 GB). None si la "
            "plataforma no permite medirlo (Windows)."
        ),
    )
    params: dict[str, object] = Field(
        default_factory=dict,
        description="Parámetros efectivos del modelo (valores JSON-serializables).",
    )
    preprocessing: list[PreprocessingStep] = Field(
        default_factory=list,
        description="Receta de preprocesamiento efectivamente aplicada.",
    )
    data_files: list[DataFileFingerprint] = Field(
        default_factory=list,
        description=(
            "Huella de los archivos de datos que entraron al análisis, "
            "en el orden de la receta."
        ),
    )
    data_fingerprint: str | None = Field(
        default=None,
        description=(
            "Huella SHA-256 que resume todos los archivos de datos. "
            "Es igual en dos corridas que usaron exactamente los mismos "
            "archivos, y distinta en cuanto uno cambia."
        ),
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
        description=(
            "Biomarcadores seleccionados, con su estabilidad. "
            "En el DIABLO son las variables que el modelo eligió en cada "
            "bloque y en cada componente."
        ),
    )
    correlations: dict[str, list[list[float]]] = Field(
        default_factory=dict,
        description=(
            "Matrices de correlación entre bloques, indexadas por par. "
            "La clave es 'bloqueA|bloqueB', con los bloques en el orden de "
            "la receta, y la matriz es la correlación entre los variates "
            "de cada bloque (una fila por componente de A, una columna por "
            "componente de B)."
        ),
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
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = Field(
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


class JobAccepted(BaseModel):
    """Identificador de un job aceptado por la API."""

    model_config = ConfigDict(extra="forbid")

    job_id: str = Field(
        ...,
        description="Identificador del job.",
    )


class JobPathsSpec(BaseModel):
    """Rutas del protocolo de archivos de un job."""

    model_config = ConfigDict(extra="forbid")

    spec: str
    progress: str
    result: str
    error: str
    log: str


class JobModelSpec(BaseModel):
    """Parámetros del modelo dentro de la especificación del job."""

    model_config = ConfigDict(extra="forbid")

    model_type: Literal["PCA", "DIABLO"]
    n_components: int = Field(ge=1, le=10)
    keepX: dict[str, list[int]] | None = None
    design: list[list[float]] | None = None
    seed: int | None = None


class JobSpec(BaseModel):
    """Especificación completa que el proceso hijo recibe por ``argv``."""

    model_config = ConfigDict(extra="forbid")

    job_id: str
    dataset_id: str
    blocks: list[BlockRef]
    alignment: Alignment | None = None
    target: TargetSpec | None = None
    model: JobModelSpec
    paths: JobPathsSpec

# ------------------------------------------------------------------------------
# RAG: preguntas sobre resultados/interpretación y generación de reportes
# ------------------------------------------------------------------------------


class RagChatRequest(BaseModel):
    """Pregunta del usuario con contexto RAG (interpretación de resultados)."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(
        ...,
        min_length=1,
        description="Pregunta del usuario (p. ej. cómo interpretar un resultado).",
    )
    job_id: str | None = Field(
        default=None,
        description=(
            "ID de un job completado para incluir su resultado/provenance como "
            "contexto. No se envían matrices crudas, solo métricas agregadas."
        ),
    )
    language: Literal["es", "en"] = Field(
        default="es",
        description="Idioma preferido de la respuesta.",
    )
    top_k: int = Field(
        default=4,
        ge=1,
        le=12,
        description="Cantidad de fragmentos de conocimiento a recuperar.",
    )


class RagSource(BaseModel):
    """Fuente recuperada que respalda una respuesta."""

    model_config = ConfigDict(extra="ignore")

    source: str = Field(..., description="Origen del fragmento (archivo/doc/job).")
    score: float | None = Field(default=None, description="Puntaje de similitud.")
    excerpt: str = Field(default="", description="Extracto breve del fragmento.")


class RagChatResponse(BaseModel):
    """Respuesta del asistente con trazabilidad de fuentes."""

    model_config = ConfigDict(extra="ignore")

    answer: str = Field(..., description="Respuesta generada por el LLM.")
    sources: list[RagSource] = Field(
        default_factory=list,
        description="Fragmentos recuperados usados como contexto.",
    )


class RagIndexRequest(BaseModel):
    """Solicitud de (re)construcción del índice RAG."""

    model_config = ConfigDict(extra="forbid")

    include_jobs: bool = Field(
        default=True,
        description="Si incluye resúmenes de resultados de jobs completados.",
    )


class RagIndexResponse(BaseModel):
    """Estado de la indexación."""

    model_config = ConfigDict(extra="ignore")

    documents: int = Field(..., description="Cantidad de documentos indexados.")
    chunks: int = Field(..., description="Cantidad de fragmentos (nodos) generados.")
    index_dir: str = Field(..., description="Ruta donde se persistió el índice.")


class ReportRequest(BaseModel):
    """Solicitud de generación de reporte PDF para un job."""

    model_config = ConfigDict(extra="forbid")

    job_id: str = Field(..., description="ID del job completado a reportar.")
    language: Literal["es", "en"] = Field(
        default="es",
        description="Idioma preferido del reporte.",
    )
    include_llm_narrative: bool = Field(
        default=True,
        description="Si incluye narrativa interpretativa generada con RAG+LLM.",
    )


class ReportResponse(BaseModel):
    """Resultado de la generación del reporte."""

    model_config = ConfigDict(extra="ignore")

    job_id: str = Field(..., description="ID del job reportado.")
    filename: str = Field(..., description="Nombre del archivo PDF generado.")
    path: str = Field(..., description="Ruta del PDF en el directorio de reportes.")