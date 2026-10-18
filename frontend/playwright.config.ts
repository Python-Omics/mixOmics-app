import { defineConfig } from '@playwright/test';

/**
 * Config de Playwright para tests E2E del frontend.
 *
 * Apunta al dev server de Vite (no a Electron) porque en el browser
 * no existe `window.pyxAPI` (esa superficie solo se inyecta desde el
 * preload de Electron). El mock se inyecta vía `addInitScript` para
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

    // Mock del preload de Electron: window.pyxAPI con respuestas
    // que reflejan que el backend no está corriendo.
    addInitScript: () => {
      const mockStatus = {
        running: false,
        port: 8501,
        logPath: null,
        startError: null,
      };
      // @ts-expect-error - mock injected for tests
      window.pyxAPI = {
        getBackendStatus: () => Promise.resolve(mockStatus),
        restartBackend: () => Promise.resolve({ ok: false, error: 'mock' }),
        api: {
          request: () =>
            Promise.resolve({ ok: false, status: 0, error: 'no backend in test' }),
          get: () =>
            Promise.resolve({ ok: false, status: 0, error: 'no backend in test' }),
          post: () =>
            Promise.resolve({ ok: false, status: 0, error: 'no backend in test' }),
          delete: () =>
            Promise.resolve({ ok: false, status: 0, error: 'no backend in test' }),
        },
        onBackendLog: () => () => {},
        onBackendExit: () => () => {},
        onBackendError: () => () => {},
      };
    },
  },

  // Arranca Vite antes de correr los tests
  webServer: {
    command: 'npm run dev:vite',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});