/**
 * Wrapper sobre window.pyxAPI.api con tipos y atajos.
 * Mantén los métodos alineados con los endpoints reales del backend FastAPI.
 */

import type { ApiResponse, ModelConfig, UploadResponse } from './types';

export const api = {
  /** Healthcheck del backend local */
  health: () => window.pyxAPI.api.get<{ status: string }>('/v1/health'),

  /** Lista de archivos actualmente cargados en el backend */
  listFiles: () => window.pyxAPI.api.get<string[]>('/v1/archivos/'),

  /**
   * Sube un CSV al backend.
   *
   * Body: `{ filename, content }` con content como string UTF-8 del CSV.
   * En esta POC el endpoint /v1/cargar/ está como placeholder (devuelve null),
   * así que el frontend sigue funcionando aunque el backend no haga nada todavía.
   */
  uploadFile: (filename: string, content: string) =>
    window.pyxAPI.api.post<UploadResponse>('/v1/cargar/', {
      filename,
      content,
    }),

  /** Borra un archivo por nombre (NO por path) */
  deleteFile: (filename: string) =>
    window.pyxAPI.api.delete<{ ok: boolean }>(
      `/v1/archivos/${encodeURIComponent(filename)}`,
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
