'use strict';

/**
 * Electron main process — Pythomics desktop.
 *
 * Responsabilidades:
 *   - Crear BrowserWindow con sandbox/contextIsolation seguros.
 *   - Antes de mostrar la UI, levantar el backend FastAPI local.
 *   - Exponer IPC handlers (api:request, backend:status, backend:restart)
 *     y forward de logs del subproceso al renderer.
 *   - Cleanup: matar el subproceso al cerrar la ventana.
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const { BackendManager } = require('./backend.cjs');

const isDev = process.env.PYTHOMICS_DEV === '1';
const BACKEND_PORT = 8501;

/**
 * Detecta si el entorno es Linux con un compositor Wayland estricto
 * (Hyprland, Sway, River, Wayfire, Cage) que requiere los flags
 * de compatibilidad para evitar crashes del GPU/sandbox process.
 *
 * Fuente: WAYLAND_DISPLAY + XDG_CURRENT_DESKTOP (variables estándar
 * de freedesktop y wlroots).
 * (Oliver) este es un fix específico para Hyprland, que tiene problemas al mostrar la ventana
 * de Electron.
 */

function isStrictWayland() {
  if (process.platform !== 'linux') return false;
  if (!process.env.WAYLAND_DISPLAY) return false;
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
  return /hyprland|sway|river|wayfire|cage/.test(desktop);
}

const wantsStrictSandbox = process.env.PYTHOMICS_STRICT_SANDBOX === '1';
const useCompatibilityFlags = !wantsStrictSandbox && isStrictWayland();

if (useCompatibilityFlags) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch(
    'disable-features',
    'AudioServiceOutOfProcess,UseChromeOSDirectVideoDecoder',
  );
  app.disableHardwareAcceleration();
}

// En dev: frontend/electron/main.cjs → ../../backend
// En prod (empaquetado): se ajustará cuando sumemos electron-builder.
const projectRoot = path.resolve(__dirname, '..', '..');
const backendDir = path.join(projectRoot, 'backend');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BackendManager | null} */
let backend = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Pythomics — Análisis multi-ómico',
    backgroundColor: '#f8fafc',
    show: false, // se muestra manualmente cuando el backend está listo
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // El sandbox del renderer se desactiva en Wayland estricto para
      // evitar crashes del preload. contextIsolation=true sigue
      // protegiendo al renderer del main process. Opt-in al sandbox
      // estricto con PYTHOMICS_STRICT_SANDBOX=1.
      sandbox: wantsStrictSandbox,
      webSecurity: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Diagnóstico: log de eventos del renderer para detectar crashes temprano
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] render-process-gone:', details);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[main] did-fail-load:', errorCode, errorDescription, validatedURL);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[main] preload-error:', preloadPath, error);
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, source) => {
    const tag = level >= 2 ? 'error' : 'log';
    console[tag](`[renderer] ${source}:${line} ${message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Abrir links externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Registra los handlers IPC y conecta los eventos del backend al renderer.
 */
function setupIpc() {
  if (!backend) return;

  // Forward de logs del subproceso al renderer
  backend.on('log', (entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:log', entry);
    }
  });

  backend.on('exit', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:exit', info);
    }
  });

  backend.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:error', err);
    }
  });

  ipcMain.handle('backend:status', () => ({
    running: backend ? backend.process !== null : false,
    port: BACKEND_PORT,
    logPath: backend ? backend.logPath : null,
    startError: backend ? backend.startError : null,
  }));

  ipcMain.handle('backend:restart', async () => {
    if (!backend) return { ok: false, error: 'Backend no inicializado' };
    await backend.stop();
    try {
      await backend.start();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Proxy HTTP al backend local — evita exponer el puerto al renderer
  ipcMain.handle('api:request', async (_event, payload) => {
    const method = (payload && payload.method) || 'GET';
    const apiPath = (payload && payload.path) || '/';
    const body = payload ? payload.body : undefined;

    const url = `http://127.0.0.1:${BACKEND_PORT}${apiPath}`;
    const init = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined && body !== null) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    try {
      const res = await fetch(url, init);
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await res.json().catch(() => null)
        : await res.text();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  });
}

app.whenReady().then(() => {
  backend = new BackendManager({
    backendDir,
    port: BACKEND_PORT,
    userDataDir: app.getPath('userData'),
  });

  setupIpc();
  createWindow();
  // Mostrar la UI de inmediato (no bloqueamos esperando al backend).
  // El badge de estado refleja "Conectando…" hasta que /v1/health
  // responda, y se actualiza en vivo vía el stream backend:log.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }

  // Arrancar el backend en background. Si falla, mostrar un diálogo
  // informativo pero sin bloquear la UI.
  backend.start({ timeoutMs: 30000 }).catch((err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'El backend no pudo iniciarse',
        message: 'Pythomics no pudo levantar el motor de análisis local.',
        detail: `${err.message}\n\nLa aplicación queda en línea, pero los análisis no funcionarán hasta que el backend esté disponible.`,
        buttons: ['OK'],
      });
    }
  });
});

app.on('window-all-closed', async () => {
  if (backend) await backend.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backend) {
    createWindow();
    mainWindow.show();
  }
});

app.on('before-quit', async (event) => {
  if (backend && backend.process) {
    event.preventDefault();
    await backend.stop();
    app.quit();
  }
});
