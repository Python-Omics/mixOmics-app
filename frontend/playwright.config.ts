import { defineConfig } from '@playwright/test';
import type {
  ApiCallRecord,
  ApiResponse,
  PyxAPI,
  UploadResponse,
} from './src/lib/types';

/**
 * Mock del preload de Electron para los tests E2E en browser.
 *
 * `window.pyxAPI` queda disponible con respuestas deterministas: la subida
 * devuelve un resumen de ingesta exitoso y el resto de endpoints
 * simula que no hay backend. Cada llamada queda registrada en
 * `window.__apiCalls` para que los tests puedan verificar contra qué rutas
 * pega el frontend.
 *
 * OJO: Playwright NO tiene `addInitScript` como opción de `use` (la opción
 * se ignora en silencio y el mock nunca llegaba al browser). Por eso la
 * función se exporta y se inyecta por página con `page.addInitScript(...)`
 * desde el `beforeEach` del spec.
 */
export type InstallApiMockOptions = {
  /** Respuesta alternativa para la subida, usada por tests de error/warning. */
  uploadResponse?: ApiResponse<unknown>;
  /**
   * Overrides del resumen del bloque en la respuesta por defecto de la
   * subida.
   *
   * Permite simular un bloque con columnas no numéricas (por ejemplo
   * `{ n_variables: 4, n_numeric_variables: 3, columns: [...] }`) sin
   * duplicar el mock.
   */
  block?: Partial<UploadResponse['block']>;
};

export function installApiMock(options: InstallApiMockOptions = {}) {
  const w = window as unknown as {
    pyxAPI: PyxAPI;
    __apiCalls?: ApiCallRecord[];
    __fileTextCalled?: boolean;
  };
  const mockStatus = {
    running: false,
    port: 8501,
    logPath: null,
    startError: null,
  };
  // Registro de llamadas al backend (lo consultan los tests).
  const calls: ApiCallRecord[] = [];
  w.__apiCalls = calls;
  w.__fileTextCalled = false;

  const originalText = File.prototype.text;
  File.prototype.text = function () {
    w.__fileTextCalled = true;
    return originalText.call(this);
  };

  const sinBackend = () =>
    Promise.resolve({ ok: false, status: 0, error: 'no backend in test' });

  w.pyxAPI = {
    getBackendStatus: () => Promise.resolve(mockStatus),
    restartBackend: () => Promise.resolve({ ok: false, error: 'mock' }),
    getPathForFile: (file: File) => `/tmp/pythomics-mock/${file.name}`,
    api: {
      request: (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        return sinBackend();
      },
      get: (path: string) => {
        calls.push({ method: 'GET', path });
        return sinBackend();
      },
      post: (path: string, body?: unknown) => {
        calls.push({ method: 'POST', path, body });
        return sinBackend();
      },
      delete: (path: string) => {
        calls.push({ method: 'DELETE', path });
        return sinBackend();
      },
      // Subida multipart: el backend espera el campo `file`.
      upload: (sourcePath: string, filename: string, content?: string) => {
        calls.push({
          method: 'POST',
          path: '/v1/archivos/',
          filename,
          sourcePath,
          content,
        });
        if (options.uploadResponse) {
          return Promise.resolve(
            options.uploadResponse,
          ) as Promise<ApiResponse<UploadResponse>>;
        }
        // El bloque por defecto tiene una sola variable, numérica. Los tests
        // pueden reconfigurarlo (por ejemplo, con columnas no numéricas).
        const overrides = options.block ?? {};
        const block: UploadResponse['block'] = {
          name: overrides.name ?? filename,
          filename: overrides.filename ?? filename,
          n_samples: overrides.n_samples ?? 2,
          n_variables: overrides.n_variables ?? 1,
          n_numeric_variables: overrides.n_numeric_variables ?? 1,
          columns: overrides.columns ?? ['feature_1'],
          sample_id_column: overrides.sample_id_column ?? 'sample_id',
        };
        return Promise.resolve({
          ok: true,
          status: 201,
          data: {
            block,
            warnings: [],
            preview: {
              columns: ['sample_id', 'feature_1'],
              rows: [
                ['S1', '1.0'],
                ['S2', '2.0'],
              ],
            },
          } satisfies UploadResponse,
        });
      },
    },
    onBackendLog: () => () => {},
    onBackendExit: () => () => {},
    onBackendError: () => () => {},
  };
}

/**
 * Config de Playwright para tests E2E del frontend.
 *
 * Apunta al dev server de Vite (no a Electron) porque en el browser
 * no existe `window.pyxAPI` (esa superficie solo se inyecta desde el
 * preload de Electron). El mock se inyecta con `installApiMock` para
 * que el frontend no rompa al intentar hablar con el backend.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Arranca Vite antes de correr los tests. reuseExistingServer=false
  // garantiza que siempre se levante uno fresco (evita falsos negativos
  // cuando un server previo se quedó colgado).
  webServer: {
    command: 'npm run dev:vite',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 60_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
