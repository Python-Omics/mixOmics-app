/**
 * Tipos compartidos entre el renderer y el preload.
 *
 * Cualquier tipo que cruce el puente IPC (window.pyxAPI) debe estar acá.
 * Los tipos de la API del backend FastAPI también van acá cuando estén
 * definidos formalmente (Pydantic).
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
 */
export type ModelType = 'PCA' | 'PLS-DA' | 'sPLS-DA' | 'DIABLO';

/**
 * Configuración mínima de un modelo para POST /v1/model/.
 * Viaja como JSON al backend; los nombres de los campos siguen la
 * nomenclatura de mixOmics (RNF-U-3).
 */
export type ModelConfig = {
  model_type: ModelType;
  n_components: number;
  keepX?: number;
  /** nombre del archivo (no path completo) ya cargado en el backend */
  filename: string;
};

/**
 * Biomarcador devuelto por el análisis (alineada con `ResumenBiomarcadores`
 * del Avance §5.1).
 */
export type Biomarker = {
  variable_id: string;
  loading: number;
  stability?: number;
  component: number;
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