/**
 * Wrapper sobre window.pyxAPI.api con tipos y atajos.
 * Mantén los métodos alineados con los endpoints reales del backend FastAPI.
 *
 * Este módulo es la única fuente de verdad de las rutas: las páginas
 * llaman acá y nunca escriben una URL a mano.
 */

import type {
  ApiResponse,
  DeleteResponse,
  FilesResponse,
  ModelConfig,
  UploadResponse,
} from './types';

export const api = {
  /** Healthcheck del backend local */
  health: () => window.pyxAPI.api.get<{ status: string }>('/v1/health'),

  /** Lista de archivos actualmente cargados en el backend */
  listFiles: () => window.pyxAPI.api.get<FilesResponse>('/v1/archivos/'),

  /**
   * Sube un CSV al backend.
   *
   * El backend espera multipart/form-data con el campo `file`, así que la
   * subida viaja por el canal `api:upload` del puente IPC (no por `api:request`).
   * `content` es el texto UTF-8 del CSV.
   */
  uploadFile: (
    filename: string,
    content: string,
  ): Promise<ApiResponse<UploadResponse>> =>
    window.pyxAPI.api.upload('/v1/archivos/', filename, content),

  /** Borra un archivo por nombre (NO por path): va como query param */
  deleteFile: (filename: string) =>
    window.pyxAPI.api.delete<DeleteResponse>(
      `/v1/archivos/?nombre_archivo=${encodeURIComponent(filename)}`,
    ),

  /** Ejecuta un modelo multivariado y devuelve el resultado */
  runModel: (config: ModelConfig) =>
    window.pyxAPI.api.post<unknown>('/v1/model/', config),

  /** Análisis preliminar con LLM sobre biomarcadores seleccionados */
  runModelLLM: (biomarkers: string[]) =>
    window.pyxAPI.api.post<{ text: string }>('/v1/model_llm/', { biomarkers }),
};

/** Helper: assert ok + log si falla */
export async function safe<T>(
  promise: Promise<ApiResponse<T>>,
  context: string,
): Promise<T | null> {
  const res = await promise;
  if (!res.ok) {
    console.warn(`[api] ${context} falló: HTTP ${res.status} ${res.error ?? ''}`);
    return null;
  }
  return res.data ?? null;
}
