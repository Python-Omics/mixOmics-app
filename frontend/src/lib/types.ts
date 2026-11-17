/**
 * Tipos compartidos entre el renderer y el preload.
 *
 * Cualquier tipo que cruce el puente IPC (window.pyxAPI) debe estar acá.
 * Los tipos de la API del backend FastAPI también van acá cuando estén
 * definidos formalmente (Pydantic).
 *
 * La sección "Contrato del backend" calcada los esquemas de
 * `backend/app/schemas.py` (fuente de verdad): `Job`, `Progress`,
 * `ModelResult`, `Figure`, `Biomarker`, `Provenance`, `Dataset`,
 * `BlockRef`, `Alignment`, `TargetSpec` y `AlignmentRequest`.
 *
 * Reglas del contrato (S21, S22, S23, S24, S27):
 *   - El backend NO traduce: devuelve `code` + `message_key`, y el renderer
 *     traduce. Por eso el error crudo de un job (`JobError`) y el error
 *     normalizado del cliente (`ApiErrorPayload`) son dos formas distintas
 *     del mismo dato, no dos duplicados.
 *   - El progreso es POR ETAPA, sin porcentaje (S30): la UI muestra una
 *     barra indeterminada con la etiqueta de la etapa.
 *   - La sesión de datos es una RECETA, no las matrices (S29): `Dataset`
 *     lleva rutas, forma e IDs de muestra, nunca los datos.
 */

// ─── Estado del backend ──────────────────────────────────────────────────────

export type BackendStatus = {
  running: boolean;
  port: number;
  logPath: string | null;
  startError: string | null;
};

export type BackendLogEntry = {
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  timestamp: number;
};

// ─── Configuración de modelos (POC) ──────────────────────────────────────────

/**
 * Tipos de modelo soportados por mixOmics. En la POC los nombres van en inglés
 * (RNF-U-3: nomenclatura científica en inglés).
 *
 * OJO: el contrato del backend solo acepta `PCA` y `DIABLO` (S6: el
 * sPLS-DA mono-bloque está diferido). `ModelType` sigue incluyendo los
 * modelos de la POC porque el selector todavía los ofrece; el tipo del
 * contrato es `BackendModelType` y la migración del selector es de la
 * segunda mitad de T10.
 */
export type ModelType = 'PCA' | 'PLS-DA' | 'sPLS-DA' | 'DIABLO';

/**
 * Valores de keepX que todavía está editando el usuario.
 *
 * Cada bloque tiene un único número: la cantidad de variables que se
 * seleccionan por componente. Si el bloque no aparece en el registro, su
 * input está vacío y no se envía al backend.
 */
export type KeepXValues = Record<string, number>;

/**
 * Configuración mínima de un modelo para POST /v1/model/.
 * Viaja como JSON al backend; los nombres de los campos siguen la
 * nomenclatura de mixOmics (RNF-U-3).
 *
 * Es la forma de la POC: manda el NOMBRE de un archivo. El contrato real
 * (`ModelRequest`) manda el `dataset_id` de la receta.
 */
export type ModelConfig = {
  model_type: ModelType;
  n_components: number;
  /** Borrador del control keepX, indexado por nombre de bloque. */
  keepXValues: KeepXValues;
  /** nombre del archivo (no path completo) ya cargado en el backend */
  filename: string;
};

// ─── Contrato del backend (backend/app/schemas.py) ─────────────────────────

/**
 * Modelos que acepta el contrato del backend (S6, S31).
 *
 * El DIABLO además necesita R y mixOmics disponibles: eso lo informa
 * `/v1/health` (S26) y la UI deshabilita la opción en vez de fallar.
 */
export type BackendModelType = 'PCA' | 'DIABLO';

/**
 * Rol de un bloque dentro de la receta.
 *
 * Lo declara el origen del archivo, no el dtype: los fenotipos de mixOmics
 * vienen codificados como enteros, así que una tabla de metadata puede
 * tener todas sus columnas numéricas (S38).
 */
export type BlockRole = 'block' | 'metadata';

/**
 * Tipo de figura que genera el análisis.
 *
 * - `pca`: sample plot del PCA (L21).
 * - `biomarkers`: loading plot del DIABLO (L22).
 * - `circos`: círculo de correlaciones del DIABLO (L22).
 * - `heatmap`: heatmap clusterizado (CIM) del DIABLO.
 * - `network`: red de relevancia del DIABLO.
 *
 * El esquema del backend admite más clases (menciona `cim`); el contrato
 * del MVP cubre estas cinco.
 */
export type FigureKind = 'pca' | 'biomarkers' | 'circos' | 'heatmap' | 'network';

/**
 * Etapa del pipeline de un job (S30).
 *
 * El progreso es por etapa, sin porcentaje: `DIABLOWrapper` no expone
 * granularidad intra-etapa y un porcentaje estimado sería una mentira. La UI
 * muestra una barra indeterminada con la etiqueta de la etapa.
 */
export type ProgressStage =
  | 'queued'
  | 'load'
  | 'align'
  | 'preprocess'
  | 'fit'
  | 'transform'
  | 'figures';

/** Estados terminales y no terminales de un job (S23). */
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Biomarcador devuelto por el análisis.
 *
 * El backend lo manda siempre con `block` (el bloque del que viene la
 * variable) y con `stability` en `null` cuando el modelo no la reporta.
 * Acá ambos son opcionales porque los componentes que los consumen
 * (`ResultsPanel` y `BiomarkersTable`) todavía no están migrados al
 * contrato: es la segunda mitad de T10 la que puede volverlos obligatorios.
 */
export type Biomarker = {
  variable_id: string;
  loading: number;
  stability?: number;
  component: number;
  block?: string;
};

/** Carga de una variable en un componente del modelo. */
export type VariableLoading = {
  variable_id: string;
  loading: number;
  /** Componente 1-based, como en mixOmics. */
  component: number;
};

/** Figura generada por el análisis (PNG dentro del directorio del job). */
export type Figure = {
  kind: FigureKind;
  /** Ruta de la figura dentro del directorio del job. */
  path: string;
  /**
   * Nombre de la figura SIN extensión: es el nombre que se pide en
   * `GET /v1/files/{job_id}/{name}.png` (L21).
   */
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
};

/** Paso de preprocesamiento registrado en la receta (RF-3, diferido en L18). */
export type PreprocessingStep = {
  op: 'center' | 'scale' | 'impute' | 'filter_zero_var';
  params: Record<string, unknown>;
  applied_at: string | null;
};

/** Variable de clase: bloque de origen + columna. */
export type TargetSpec = {
  /** Nombre del bloque que aporta la variable de clase. */
  block: string;
  /** Columna dentro de ese bloque. */
  column: string;
};

/**
 * Referencia a un bloque dentro de la receta.
 *
 * La receta es autosuficiente: el worker no necesita reinterpretar el
 * archivo para saber qué columnas son numéricas y cuáles categóricas.
 */
export type BlockRef = {
  /** Nombre del archivo del bloque (por ejemplo 'nutrimouse_gene.csv'). */
  name: string;
  role: BlockRole;
  /** Ruta del archivo en el disco del backend. */
  path: string;
  n_samples: number;
  n_variables: number;
  /** Variables numéricas del bloque, por dtype (no por rol). */
  n_numeric_variables: number;
  /** Columnas que NO son numéricas; el resto se deduce por diferencia. */
  categorical_columns: string[];
  /** IDs de muestra leídos de la primera columna, en orden. */
  sample_ids: string[];
};

/**
 * Decisión de alineación entre bloques, por ID y no por posición (RB-3).
 *
 * El orden de `sample_ids` es parte del contrato: es el orden canónico que
 * usa R, y el que hace comparables las paridades.
 */
export type Alignment = {
  /** IDs de muestra supervivientes, en orden. */
  sample_ids: string[];
  /** IDs descartados por bloque. */
  discarded: Record<string, string[]>;
  /** Si el usuario confirmó la alineación. */
  confirmed: boolean;
};

/**
 * Solicitud de alineación (RF-2, RB-3).
 *
 * El cliente manda los NOMBRES de los bloques, en orden: el primero fija el
 * orden canónico de las muestras.
 */
export type AlignmentRequest = {
  blocks: string[];
  confirmed: boolean;
};

/**
 * Sesión de datos del backend: la receta, nunca las matrices (S29).
 *
 * Las matrices crudas no viajan al renderer (RB-9, RNF-S-3): la receta
 * lleva rutas, forma e IDs de muestra.
 */
export type Dataset = {
  id: string;
  blocks: BlockRef[];
  alignment: Alignment | null;
  preprocessing: PreprocessingStep[];
  target: TargetSpec | null;
};

/** Bloque solicitado para una receta: el archivo y el rol que tiene. */
export type DatasetBlockInput = {
  /** Nombre del archivo subido: nunca una ruta. */
  name: string;
  role: BlockRole;
};

/** Progreso del job por etapa, sin porcentaje (S13, S30). */
export type Progress = {
  stage: ProgressStage;
  /** Índice de la etapa actual, base 0 (load=0 ... figures=5). */
  index: number;
  /** Cantidad total de etapas del pipeline. */
  total: number;
};

/**
 * Error crudo del backend, tal como viaja en el sobre
 * `{"error": {"code", "message_key", "detail"}}` (S22).
 *
 * `ApiErrorPayload` es la forma NORMALIZADA que usa el cliente (con
 * `messageKey` en camelCase); esta es la que llega dentro de un job.
 */
export type JobError = {
  code: string;
  /** Clave i18n que el renderer resuelve. */
  message_key: string;
  detail: Record<string, unknown>;
};

/** Identidad de un archivo de datos que entró al análisis (RB-7). */
export type DataFileFingerprint = {
  name: string;
  role: string;
  /** Huella SHA-256 del contenido del archivo. */
  sha256: string;
  size_bytes: number;
};

/**
 * Trazabilidad del análisis (RB-7): versiones, semilla, parámetros y receta.
 *
 * `seed` es la semilla EFECTIVA (la pedida o la generada): toda operación
 * aleatoria acepta semilla y se registra (RB-6).
 */
export type Provenance = {
  pythomics_version: string;
  r_version: string | null;
  mixomics_version: string | null;
  seed: number;
  /**
   * Pico de memoria residente del proceso que corrió el análisis, en MB
   * (RNF-R-3). Null si la plataforma no permite medirlo (Windows).
   */
  peak_rss_mb?: number | null;
  /** Parámetros efectivos del modelo (JSON-serializables). */
  params: Record<string, unknown>;
  preprocessing: PreprocessingStep[];
  data_files: DataFileFingerprint[];
  /** Huella que resume todos los archivos de datos del análisis. */
  data_fingerprint: string | null;
  /** Marca de tiempo ISO 8601 de creación del reporte. */
  created_at: string;
};

/**
 * Resultado del análisis, con whitelist de serialización.
 *
 * `biomarkers` es una lista PLATA de biomarcadores (no un diccionario por
 * bloque) y `correlations` se indexa con la clave `"bloqueA|bloqueB"`, con
 * los bloques en el orden de la receta.
 */
export type ModelResult = {
  model_type: string;
  /** Nombres de los bloques que participaron del análisis. */
  blocks: string[];
  n_components: number;
  /** Varianza explicada por componente, si el modelo la reporta. */
  explained_variance_ratio: number[] | null;
  /** Scores por bloque: filas = muestras, columnas = componentes. */
  scores: Record<string, number[][]>;
  /** Loadings por bloque. */
  loadings: Record<string, VariableLoading[]>;
  /** Biomarcadores seleccionados, en lista plana. */
  biomarkers: Biomarker[];
  /** Correlaciones entre bloques, indexadas por `"bloqueA|bloqueB"`. */
  correlations: Record<string, number[][]>;
  figures: Figure[];
  provenance: Provenance;
};

/** Estado de un job de análisis asíncrono (S4, S23). */
export type Job = {
  job_id: string;
  status: JobStatus;
  progress: Progress | null;
  result: ModelResult | null;
  error: JobError | null;
};

/** Identificador de un job aceptado por la API (`202 {job_id}`). */
export type JobAccepted = {
  job_id: string;
};

/**
 * Solicitud de ejecución de un modelo (RF-4 PCA / RF-8 DIABLO).
 *
 * El backend NO recibe archivos: recibe el `dataset_id` de la receta y los
 * parámetros del modelo. La alineación y el preprocesamiento son pasos
 * explícitos y ya registrados en la receta (S3, S17).
 */
export type ModelRequest = {
  dataset_id: string;
  model_type: BackendModelType;
  n_components: number;
  /** Variables a conservar por bloque (convención de mixOmics). */
  keepX?: Record<string, number[]>;
  /** Matriz de diseño p×p del DIABLO; sin ella, el default de mixOmics. */
  design?: number[][];
  /** Variable de clase para modelos supervisados. */
  target?: TargetSpec;
  /** Semilla aleatoria (RB-6); sin ella, el backend genera y registra una. */
  seed?: number;
};

/**
 * Figura servida por el canal `api:file`: el PNG en base64.
 *
 * El renderer arma un `blob:` URL a partir del base64; el binario nunca
 * viaja dentro del JSON del job (S27).
 */
export type FigurePayload = {
  mime: string;
  dataBase64: string;
};

// ─── UI / navegación ─────────────────────────────────────────────────────────

/**
 * Pantalla activa. `home` es la pantalla de Inicio (hero + CTA, sin sidebar);
 * `pipeline` es el flujo de 3 pasos con el sidebar.
 *
 * Estado de dos niveles, sin router: `screen` decide cuál de las dos se
 * renderiza y `Step` solo aplica dentro de `pipeline`.
 */
export type Screen = 'home' | 'pipeline';

export type Step = 'load' | 'configure' | 'results';

// ─── API expuesta por el preload (window.pyxAPI) ────────────────────────────

/**
 * Error estructurado que devuelve el backend, dentro del sobre
 * `{"error": {"code", "message_key", "detail"}}`.
 *
 * - `code`: código estable del backend (`E_*`).
 * - `messageKey`: clave de i18n que el renderer resuelve en sus catálogos.
 * - `detail`: datos estructurados del error (archivo, IDs duplicados, ...).
 */
export type ApiErrorPayload = {
  code: string;
  messageKey: string;
  detail?: Record<string, unknown>;
};

export type ApiResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /**
   * Error estructurado del backend, ya normalizado.
   *
   * Lo puebla la capa del renderer (`withApiError` en `lib/api.ts`), no el
   * puente IPC: por eso es opcional y solo aparece cuando la respuesta no
   * fue OK y el cuerpo trae el sobre del backend.
   */
  apiError?: ApiErrorPayload;
};

/** Response de GET /v1/archivos/ (archivos cargados en el backend). */
export type FilesResponse = {
  archivos: string[];
  total: number;
  ruta: string;
};

/** Advertencia no bloqueante emitida durante la ingesta de un bloque. */
export type IngestWarning = {
  code: string;
  message_key: string;
  columns?: string[];
  detail?: Record<string, unknown>;
};

/**
 * Response de POST /v1/archivos/ (subida multipart de un CSV/TSV).
 *
 * El backend describe el bloque ingerido con hechos, no con juicios: no
 * dice "esto es metadata", dice cuántas columnas son numéricas por dtype y
 * cuáles son las columnas de variables. El ROL del bloque (matriz del modelo
 * vs. tabla de fenotipo) lo determina el origen del archivo en el renderer
 * (ver `FileRole` en `lib/project-state.tsx`).
 */
export type UploadResponse = {
  block: {
    /** Nombre del bloque (nombre del archivo sin extensión). */
    name: string;
    /** Nombre del archivo ingerido en el backend. */
    filename: string;
    /** Cantidad de muestras (filas) del bloque. */
    n_samples: number;
    /**
     * Cantidad TOTAL de variables del bloque: todas las columnas de
     * variables (sin la del ID de muestra), numéricas **y** no numéricas.
     *
     * Antes contaba solo las numéricas; ahora es el total, y el detalle
     * numérico vive en `n_numeric_variables`.
     */
    n_variables: number;
    /**
     * Cantidad de columnas que son numéricas POR DTYPE.
     *
     * Ojo: los fenotipos de mixOmics vienen codificados como enteros
     * (`genotype` 1/2, `diet` 1/3/5), así que un archivo de metadata puede
     * tener todas sus columnas numéricas. Este número NO dice cuántas
     * features tiene el bloque ni si es metadata.
     */
    n_numeric_variables: number;
    /**
     * Nombres de todas las columnas de variables del bloque (sin la del ID
     * de muestra). El backend las topa a 100.
     *
     * Es la lista de candidatas a columna de clase.
     */
    columns: string[];
    /** Columna que contiene los IDs de muestra. */
    sample_id_column: string;
  };
  warnings: IngestWarning[];
  preview: { columns: string[]; rows: string[][] };
};

/** Response de DELETE /v1/archivos/?nombre_archivo=... */
export type DeleteResponse = {
  mensaje: string;
};

/**
 * Registro de una llamada al backend. Lo usa el mock de Playwright para
 * verificar contra qué rutas pega el frontend (tests E2E).
 */
export type ApiCallRecord = {
  method: string;
  path: string;
  body?: unknown;
  filename?: string;
  /** Ruta local entregada al canal de subida. */
  sourcePath?: string;
  /** Contenido opcional del fallback para assets sin ruta local. */
  content?: string;
};

export interface PyxAPI {
  getBackendStatus(): Promise<BackendStatus>;
  restartBackend(): Promise<{ ok: boolean; error?: string }>;
  /**
   * Obtiene la ruta de un archivo elegido o arrastrado por el usuario.
   * `webUtils.getPathForFile` es la API soportada desde Electron 32.
   */
  getPathForFile(file: File): string;

  api: {
    request<T = unknown>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<ApiResponse<T>>;
    get<T = unknown>(path: string): Promise<ApiResponse<T>>;
    post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
    delete<T = unknown>(path: string): Promise<ApiResponse<T>>;
    /**
     * Sube un archivo como multipart/form-data (campo `file`).
     *
     * `path` es la ruta local en disco. `content` queda como fallback para
     * assets estáticos que no tienen una ruta que Electron pueda abrir.
     */
    upload(
      path: string,
      filename: string,
      content?: string,
    ): Promise<ApiResponse<UploadResponse>>;
    /**
     * Pide una figura (PNG) de un job.
     *
     * No usa `api:request`: ese canal devuelve JSON o texto, y una figura
     * es binaria. El proceso main pide el PNG al backend con el token
     * compartido y devuelve `{mime, dataBase64}` (S27). El token nunca
     * llega al renderer.
     *
     * `name` es el nombre de la figura SIN extensión (L21): la URL que
     * arma el proceso main es `/v1/files/{job_id}/{name}.png`.
     */
    getFigure(jobId: string, name: string): Promise<ApiResponse<FigurePayload>>;
  };

  onBackendLog(callback: (entry: BackendLogEntry) => void): () => void;
  onBackendExit(
    callback: (info: { code: number | null; signal: string | null }) => void,
  ): () => void;
  onBackendError(callback: (err: { message: string }) => void): () => void;
}

declare global {
  interface Window {
    pyxAPI: PyxAPI;
    /**
     * Llamadas al backend registradas por el mock de Playwright.
     * Solo existe en el entorno de tests.
     */
    __apiCalls?: ApiCallRecord[];
  }
}