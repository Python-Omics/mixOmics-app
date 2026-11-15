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
 */

import type {
  ApiErrorPayload,
  ApiResponse,
  DeleteResponse,
  FilesResponse,
  ModelConfig,
  UploadResponse,
} from './types';

// Se re-exportan para que las páginas (y los tests) los importen desde acá,
// que es donde vive el acceso a la API.
export type { ApiErrorPayload, ApiResponse };

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

  /** Ejecuta un modelo multivariado y devuelve el resultado */
  runModel: async (config: ModelConfig) =>
    withApiError(await window.pyxAPI.api.post<unknown>('/v1/model/', config)),

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
