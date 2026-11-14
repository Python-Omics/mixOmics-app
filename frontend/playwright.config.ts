import { defineConfig } from '@playwright/test';
import type { ApiCallRecord } from './src/lib/types';

/**
 * Mock del preload de Electron para los tests E2E en browser.
 *
 * `window.pyxAPI` queda disponible con respuestas que reflejan que el
 * backend no está corriendo, y cada llamada queda registrada en
 * `window.__apiCalls` para que los tests puedan verificar contra qué rutas
 * pega el frontend.
 *
 * OJO: Playwright NO tiene `addInitScript` como opción de `use` (la opción
 * se ignora en silencio y el mock nunca llegaba al browser). Por eso la
 * función se exporta y se inyecta por página con `page.addInitScript(...)`
 * desde el `beforeEach` del spec.
 */
export function installApiMock() {
  const mockStatus = {
    running: false,
    port: 8501,
    logPath: null,
    startError: null,
  };
  // Registro de llamadas al backend (lo consultan los tests).
  const calls: ApiCallRecord[] = [];
  // @ts-expect-error - mock injected for tests
  window.__apiCalls = calls;

  const sinBackend = () =>
    Promise.resolve({ ok: false, status: 0, error: 'no backend in test' });

  // @ts-expect-error - mock injected for tests
  window.pyxAPI = {
    getBackendStatus: () => Promise.resolve(mockStatus),
    restartBackend: () => Promise.resolve({ ok: false, error: 'mock' }),
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
      upload: (path: string, filename: string) => {
        calls.push({ method: 'POST', path, filename });
        return sinBackend();
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
