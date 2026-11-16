/**
 * Wrapper sobre window.pyxAPI.api con tipos y atajos.
 * Mantén los métodos alineados con los endpoints reales del backend FastAPI.
 *
 * Este módulo es la única fuente de verdad de las rutas: las páginas
 * llaman acá y nunca escriben una URL a mano.
 *
 * Los errores de dominio del backend llegan en su propio sobre
 * (`{"error": {code, message_key, detail}}`). El proxy IPC no se modifica
 * desde acá, así que el sobre se normaliza en el renderer: `extractApiError()`
 * lo lee del cuerpo ya parseado (`res.data`) y las respuestas quedan con el
 * campo `apiError` listo para que la página lo traduzca.
 *
 * Los métodos del contrato real (S21):
 *
 * | Método                | Endpoint                        | Devuelve         |
 * | --------------------- | ------------------------------- | ---------------- |
 * | `createDataset`       | POST /v1/datasets/              | `Dataset`        |
 * | `alignDataset`        | POST /v1/datasets/{id}/align/   | `Alignment`      |
 * | `setDatasetTarget`    | POST /v1/datasets/{id}/target/  | `Dataset`        |
 * | `runModel`            | POST /v1/model/                 | `{job_id}`       |
 * | `getJob`              | GET  /v1/jobs/{id}/             | `Job`            |
 * | `cancelJob`           | DELETE /v1/jobs/{id}/           | `{job_id}`       |
 * | `getFigure`           | canal `api:file`                | `{mime, base64}` |
 *
 * El renderer NUNCA habla con el puerto del backend: todo pasa por el
 * puente IPC de Electron (S21). `getFigure` además viaja por su propio
 * canal porque una figura es binaria y `api:request` solo devuelve JSON o
 * texto (S27).
 */

import type {
  Alignment,
  AlignmentRequest,
  ApiErrorPayload,
  ApiResponse,
  Dataset,
  DatasetBlockInput,
  DeleteResponse,
  FigurePayload,
  FilesResponse,
  Job,
  JobAccepted,
  ModelRequest,
  TargetSpec,
  UploadResponse,
} from './types';
import esCatalog from '../i18n/es.json';
import type { MessageKey } from '../i18n/messages';

// Se re-exportan para que las páginas (y los tests) los importen desde acá,
// que es donde vive el acceso a la API.
export type { ApiErrorPayload, ApiResponse };

/**
 * Firma de la función de traducción (`useTranslate()`).
 *
 * Se declara localmente para que este módulo no dependa de react-intl: lo
 * único que necesita es saber qué clave se resuelve y con qué valores.
 */
export type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

/**
 * Todas las claves del catálogo, en runtime.
 *
 * Sirve para resolver las claves que llegan del backend (`message_key`):
 * solo se resuelve una clave que exista de verdad en el catálogo, así que la
 * UI nunca muestra una clave cruda.
 */
const CATALOG_KEYS: ReadonlySet<string> = new Set(Object.keys(esCatalog));

/**
 * ¿Es un objeto plano (no array) con claves?
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extrae el error estructurado del backend de un cuerpo de respuesta.
 *
 * El backend devuelve dos formas:
 *   - el sobre propio:  { "error": { code, message_key, detail } }
 *   - la de FastAPI:    { "detail": "..." } o { "detail": [...] }
 *
 * Devuelve null si el cuerpo no es un error.
 */
export function extractApiError(data: unknown): ApiErrorPayload | null {
  if (!isPlainRecord(data)) return null;
  const envelope = data.error;
  if (!isPlainRecord(envelope)) return null;

  const code = envelope.code;
  const messageKey = envelope.message_key;
  if (typeof code !== 'string' || typeof messageKey !== 'string') return null;

  return {
    code,
    messageKey,
    detail: isPlainRecord(envelope.detail) ? envelope.detail : undefined,
  };
}

/**
 * Enriquece una respuesta con el error estructurado del backend.
 *
 * El proxy devuelve el cuerpo ya parseado en `data`: el sobre de error vive
 * ahí. Se normaliza a `apiError` para que las páginas no tengan que conocer
 * la forma del sobre (ni la de FastAPI).
 */
export function withApiError<T>(res: ApiResponse<T>): ApiResponse<T> {
  if (res.ok) return res;
  const apiError = extractApiError(res.data);
  return apiError ? { ...res, apiError } : res;
}

export const api = {
  /** Healthcheck del backend local */
  health: async () =>
    withApiError(await window.pyxAPI.api.get<{ status: string }>('/v1/health')),

  /** Lista de archivos actualmente cargados en el backend */
  listFiles: async () =>
    withApiError(await window.pyxAPI.api.get<FilesResponse>('/v1/archivos/')),

  /**
   * Sube un CSV/TSV al backend.
   *
   * El backend espera multipart/form-data con el campo `file`, así que la
   * subida viaja por el canal `api:upload` del puente IPC (no por
   * `api:request`). Para archivos del usuario, `path` es la ruta local y el
   * proceso Electron arma el cuerpo multipart leyendo el archivo del disco.
   * `content` queda como fallback para assets estáticos sin ruta local.
   */
  uploadFile: async (
    path: string,
    filename: string,
    content?: string,
  ): Promise<ApiResponse<UploadResponse>> =>
    withApiError(await window.pyxAPI.api.upload(path, filename, content)),

  /** Borra un archivo por nombre (NO por path): va como query param */
  deleteFile: async (filename: string) =>
    withApiError(
      await window.pyxAPI.api.delete<DeleteResponse>(
        `/v1/archivos/?nombre_archivo=${encodeURIComponent(filename)}`,
      ),
    ),

  /**
   * Crea la receta de datos: qué archivos componen el análisis (S3, S29).
   *
   * El cliente manda NOMBRES de archivo, nunca rutas: el backend resuelve
   * el archivo dentro de su propio directorio de datos.
   *
   * `target` es opcional: una receta no supervisada (PCA) puede no tener
   * variable de clase, y una supervisada puede fijarla más tarde con
   * `setDatasetTarget`.
   */
  createDataset: async (
    blocks: DatasetBlockInput[],
    target?: TargetSpec,
  ): Promise<ApiResponse<Dataset>> =>
    withApiError(
      await window.pyxAPI.api.post<Dataset>('/v1/datasets/', {
        blocks,
        ...(target ? { target } : {}),
      }),
    ),

  /**
   * Alinea los bloques de una receta por ID y no por posición (RF-2, RB-3).
   *
   * `blocks` va en orden: el primero fija el orden canónico de las
   * muestras. Es idempotente y re-invocable (excluir un bloque es llamar
   * con menos bloques).
   */
  alignDataset: async (
    datasetId: string,
    request: AlignmentRequest,
  ): Promise<ApiResponse<Alignment>> =>
    withApiError(
      await window.pyxAPI.api.post<Alignment>(
        `/v1/datasets/${encodeURIComponent(datasetId)}/align/`,
        request,
      ),
    ),

  /**
   * Fija (o cambia) la variable de clase de una receta (S38).
   *
   * El backend valida que el bloque pertenezca a la receta; la columna se
   * valida en el model request, que es quien sabe qué columnas existen.
   */
  setDatasetTarget: async (
    datasetId: string,
    target: TargetSpec,
  ): Promise<ApiResponse<Dataset>> =>
    withApiError(
      await window.pyxAPI.api.post<Dataset>(
        `/v1/datasets/${encodeURIComponent(datasetId)}/target/`,
        target,
      ),
    ),

  /**
   * Recupera una receta guardada en el backend (S3).
   *
   * Es lo que permite volver a la pantalla de configuración sin crear una
   * receta nueva: el backend es el dueño del estado de la sesión.
   */
  getDataset: async (datasetId: string): Promise<ApiResponse<Dataset>> =>
    withApiError(
      await window.pyxAPI.api.get<Dataset>(
        `/v1/datasets/${encodeURIComponent(datasetId)}/`,
      ),
    ),

  /**
   * Ejecuta un modelo multivariado y devuelve el job (RF-4, RF-8).
   *
   * El contrato real es `ModelRequest`: el backend NO recibe archivos,
   * sino el `dataset_id` de la receta y los parámetros del modelo
   * (`backend/app/schemas.py: ModelRequest`). Responde `202 {job_id}`: el
   * resultado se consulta con `getJob`.
   */
  runModel: async (
    request: ModelRequest,
  ): Promise<ApiResponse<JobAccepted>> =>
    withApiError(await window.pyxAPI.api.post<JobAccepted>('/v1/model/', request)),

  /**
   * Estado de un job: progreso, resultado y error (S23).
   *
   * El polling lo hace el renderer (≈700 ms): todo el tráfico va por el
   * puente IPC, así que se mantiene un solo mecanismo.
   */
  getJob: async (jobId: string): Promise<ApiResponse<Job>> =>
    withApiError(
      await window.pyxAPI.api.get<Job>(
        `/v1/jobs/${encodeURIComponent(jobId)}/`,
      ),
    ),

  /** Cancela un job: mata el proceso hijo del worker (S4, S13). */
  cancelJob: async (jobId: string): Promise<ApiResponse<JobAccepted>> =>
    withApiError(
      await window.pyxAPI.api.delete<JobAccepted>(
        `/v1/jobs/${encodeURIComponent(jobId)}/`,
      ),
    ),

  /**
   * Pide una figura (PNG) de un job (S27).
   *
   * No usa `api:request`: ese canal devuelve JSON o texto, y una figura es
   * binaria. El canal `api:file` lo pide en el proceso main (que es el
   * único que conoce el puerto y el token) y devuelve el PNG en base64;
   * el renderer arma un `blob:` URL a partir de ese base64.
   *
   * `name` es el nombre de la figura SIN extensión (L21).
   */
  getFigure: async (
    jobId: string,
    name: string,
  ): Promise<ApiResponse<FigurePayload>> =>
    withApiError(await window.pyxAPI.api.getFigure(jobId, name)),

  /** Análisis preliminar con LLM sobre biomarcadores seleccionados */
  runModelLLM: async (biomarkers: string[]) =>
    withApiError(
      await window.pyxAPI.api.post<{ text: string }>('/v1/model_llm/', {
        biomarkers,
      }),
    ),
};

/** Helper: assert ok + log si falla */
export async function safe<T>(
  promise: Promise<ApiResponse<T>>,
  context: string,
): Promise<T | null> {
  const res = await promise;
  if (!res.ok) {
    const apiError = res.apiError ?? extractApiError(res.data);
    console.warn(
      `[api] ${context} failed: HTTP ${res.status} ${res.error ?? ''}`,
      apiError ?? null,
    );
    return null;
  }
  return res.data ?? null;
}

// ─── Traducción de los errores del backend ───────────────────────────────────

/**
 * Convierte un código de error del backend en el sufijo de su clave i18n.
 *
 * El backend deriva la clave con la misma regla (`errors.<camelCase>`), así
 * que un código conocido encuentra siempre su traducción, aunque el
 * `message_key` venga incompleto.
 */
function errorKeySuffix(code: string): string {
  const partes = code
    .replace(/^E_/, '')
    .toLowerCase()
    .split('_')
    .filter((parte) => parte.length > 0);
  if (partes.length === 0) return '';
  return partes
    .map((parte, index) =>
      index === 0 ? parte : parte.charAt(0).toUpperCase() + parte.slice(1),
    )
    .join('');
}

/**
 * Resuelve la clave de catálogo de un error estructurado del backend.
 *
 * Primero se respeta el `message_key` que manda el backend; si no está en el
 * catálogo, se deriva del código; si no hay ninguna, `null` (el llamador
 * muestra el texto genérico).
 */
export function resolveErrorMessageKey(
  payload: ApiErrorPayload,
): MessageKey | null {
  if (CATALOG_KEYS.has(payload.messageKey)) {
    return payload.messageKey as MessageKey;
  }
  const derivada = `errors.${errorKeySuffix(payload.code)}`;
  return CATALOG_KEYS.has(derivada) ? (derivada as MessageKey) : null;
}

/**
 * Arma los valores de interpolación de un error del backend.
 *
 * Salen del `detail` estructurado (solo primitivos: los arrays de IDs se
 * unen con comas) y se completa con el archivo de la operación en curso,
 * para que los mensajes que nombran el archivo siempre puedan interpolar
 * `{file}`.
 */
export function buildErrorValues(
  detail: Record<string, unknown> | undefined,
  context: { filename?: string } = {},
): Record<string, string | number> {
  const values: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(detail ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') {
      values[key] = value;
    } else if (Array.isArray(value)) {
      const joined = value.filter((item) => typeof item === 'string').join(', ');
      if (joined) values[key] = joined;
    }
  }

  if (context.filename && values.file === undefined) {
    values.file = context.filename;
  }

  return values;
}

/**
 * Extrae el `detail` de FastAPI: un string o la lista de errores de
 * validación (422).
 *
 * Es el formato que sigue usando FastAPI para la validación de Pydantic y
 * para las rutas inexistentes.
 */
export function extractFastApiDetail(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('detail' in data)) return null;
  const detail = (data as { detail: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const textos = detail
      .map((item) =>
        item && typeof item === 'object' && 'msg' in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      .filter((texto) => texto.length > 0);
    return textos.length > 0 ? textos.join('; ') : null;
  }
  return null;
}

/**
 * Traduce el mensaje de error de una respuesta no exitosa.
 *
 * Tres formas, en este orden:
 *   1. el sobre del backend (`{ error: { code, message_key, detail } }`): se
 *      resuelve la clave de i18n y se interpolan los datos del `detail`;
 *   2. la forma de FastAPI (`{ detail: "..." }`): se muestra el texto tal
 *      cual, porque el backend no lo traduce;
 *   3. la lista de validación de Pydantic (`{ detail: [...] }`): se unen los
 *      mensajes de validación.
 *
 * Devuelve null si no hay nada que mostrar.
 */
export function buildErrorMessage(
  res: ApiResponse<unknown>,
  t: Translate,
  context: { filename?: string } = {},
): string | null {
  const apiError = res.apiError ?? extractApiError(res.data);

  if (apiError) {
    const key = resolveErrorMessageKey(apiError);
    if (!key) return t('common.error');
    const texto = t(key, buildErrorValues(apiError.detail, context));
    return texto === key ? t('common.error') : texto;
  }

  return extractFastApiDetail(res.data);
}
