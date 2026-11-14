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

export type ApiResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

/** Response de GET /v1/archivos/ (archivos cargados en el backend). */
export type FilesResponse = {
  archivos: string[];
  total: number;
  ruta: string;
};

/** Response de POST /v1/archivos/ (subida multipart de un CSV). */
export type UploadResponse = {
  mensaje: string;
  nombre: string;
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
};

export interface PyxAPI {
  getBackendStatus(): Promise<BackendStatus>;
  restartBackend(): Promise<{ ok: boolean; error?: string }>;

  api: {
    request<T = unknown>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<ApiResponse<T>>;
    get<T = unknown>(path: string): Promise<ApiResponse<T>>;
    post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
    delete<T = unknown>(path: string): Promise<ApiResponse<T>>;
    /** Sube un archivo como multipart/form-data (campo `file`). */
    upload(
      path: string,
      filename: string,
      content: string,
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