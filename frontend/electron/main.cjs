'use strict';

/**
 * Electron main process — Pythomics desktop.
 *
 * Responsabilidades:
 *   - Crear BrowserWindow con sandbox/contextIsolation seguros.
 *   - Antes de mostrar la UI, levantar el backend FastAPI local.
 *   - Exponer IPC handlers (api:request, api:upload, backend:status,
 *     backend:restart) y forward de logs del subproceso al renderer.
 *   - Cleanup: matar el subproceso al cerrar la ventana.
 */

const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { BackendManager } = require('./backend.cjs');

const isDev = process.env.PYTHOMICS_DEV === '1';
const BACKEND_PORT = 8501;

/**
 * Token compartido con el backend local.
 *
 * El backend escucha en 127.0.0.1, y eso NO lo vuelve privado: cualquier
 * pagina web abierta por el usuario puede hacer un POST a
 * http://127.0.0.1:8501/v1/archivos/ — sin CORS el navegador no le impide
 * ENVIAR la peticion, solo LEER la respuesta. Con este token, una pagina
 * ajena no puede enviar esa cabecera (habria que pasar por un preflight que
 * el backend no responde con headers CORS), asi que no puede escribir.
 *
 * El token se pasa al backend por entorno: nunca viaja por la red.
 */
const API_TOKEN = crypto.randomBytes(32).toString('hex');

// Esquema propio para servir el bundle de producción.
//
// Por qué no file:// — con loadFile() el documento tiene origen opaco ('null'),
// y la CSP con 'self' no matchea: el bundle JS/CSS entero queda bloqueado y
// la app no arranca (#root vacío). Con un esquema registrado como 'standard',
// el origen es app://pythomics, la CSP puede usar 'self' sin relajarse y el
// guard de path traversal lo hace explícito.
const APP_SCHEME = 'app';
const APP_HOST = 'pythomics';
const DIST_DIR = path.join(__dirname, '..', 'dist');

// registerSchemesAsPrivileged debe ejecutarse ANTES de que Electron esté ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

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
/**
 * Smoke de producción.
 *
 * Con PYTHOMICS_SMOKE=1 la app arranca contra el build compilado, verifica
 * que el renderer montó y que la CSP no bloqueó nada, y sale con código 0/1.
 *
 * Existe porque la build de producción estuvo rota (origen file:// opaco →
 * la CSP bloqueaba el bundle entero) y nadie lo notó: toda la sesión se
 * desarrolló con `npm run dev`, donde el build roto no se manifiesta.
 *
 * Uso:  npm run smoke
 */
function setupSmokeCheck() {
  if (process.env.PYTHOMICS_SMOKE !== '1') return;

  const violations = [];
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (/Content Security Policy|Refused to/i.test(message)) {
      violations.push(String(message).slice(0, 300));
    }
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    // Dar tiempo a que React monte.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let info = null;
    try {
      info = await mainWindow.webContents.executeJavaScript(`({
        url: location.href,
        origin: location.origin,
        theme: document.documentElement.getAttribute('data-theme'),
        rootLen: (document.getElementById('root') || {}).innerHTML?.length ?? -1,
        h1: (document.querySelector('h1') || {}).textContent ?? null,
      })`);
    } catch (err) {
      console.error('[smoke] no se pudo evaluar el renderer:', err.message);
    }

    const checks = [
      ['el renderer montó', Boolean(info && info.rootLen > 0)],
      ['hay un <h1> en la página', Boolean(info && info.h1)],
      ['el tema se aplicó', Boolean(info && info.theme)],
      ['sin violaciones de CSP', violations.length === 0],
    ];
    if (!isDev) {
      checks.push([
        'origen real app:// (no file:// opaco)',
        Boolean(info && info.origin === 'app://pythomics'),
      ]);
    }

    console.log(`[smoke] ${JSON.stringify(info)}`);
    let ok = true;
    for (const [name, passed] of checks) {
      console.log(`[smoke] ${passed ? 'OK   ' : 'FALLA'} ${name}`);
      if (!passed) ok = false;
    }
    for (const v of violations) {
      console.error('[smoke] violacion CSP:', v);
    }

    app.exit(ok ? 0 : 1);
  });
}

let mainWindow = null;
/** @type {BackendManager | null} */
let backend = null;

/**
 * Sirve dist/ bajo app://pythomics/.
 *
 * El guard de path traversal es explícito: aunque el esquema sea privileges,
 * una ruta con '..' no debe poder salirse de dist/.
 */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const relative = pathname.replace(/^\/+/, '') || 'index.html';
    const resolved = path.resolve(path.join(DIST_DIR, relative));

    if (resolved !== DIST_DIR && !resolved.startsWith(DIST_DIR + path.sep)) {
      console.error('[main] path traversal bloqueado:', request.url);
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(resolved).toString());
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // Sin `title`: la ventana sigue el <title> del documento, que app-init.js
    // ajusta al idioma antes del primer paint.
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
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
    // Origen real (app://pythomics) en vez de file://, para que la CSP
    // pueda usar 'self' sin relajar la política.
    mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
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
      headers: {
        'Content-Type': 'application/json',
        'X-Pythomics-Token': API_TOKEN,
      },
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

  // Subida de archivos: el backend espera multipart/form-data, no JSON.
  // Va aparte de `api:request` porque esa ruta siempre manda
  // Content-Type: application/json.
  ipcMain.handle('api:upload', async (_event, payload) => {
    const apiPath = (payload && payload.path) || '/';
    const filename = (payload && payload.filename) || '';
    const content = (payload && payload.content) || '';

    const url = `http://127.0.0.1:${BACKEND_PORT}${apiPath}`;
    try {
      const form = new FormData();
      // El MIME se deriva de la extensión: el dropzone acepta .csv y .tsv
      // (RB-14), y mandarlos todos como text/csv sería incorrecto para
      // los tab-separados.
      const mime = filename.toLowerCase().endsWith('.tsv')
        ? 'text/tab-separated-values'
        : 'text/csv';
      form.append('file', new Blob([content], { type: mime }), filename);
      // OJO: NO setear Content-Type a mano. fetch lo arma con el boundary
      // correcto; si se define a mano, el boundary queda mal y FastAPI
      // rechaza el archivo.
      const res = await fetch(url, { method: 'POST', body: form, headers: { 'X-Pythomics-Token': API_TOKEN } });
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
  // El esquema app:// solo puede handler-arse con la app ya lista.
  if (!isDev) {
    registerAppProtocol();
  }

  const userDataDir = app.getPath('userData');
  // El directorio de datos del backend:
  //   - en desarrollo, dentro del repo (backend/data, gitignorado), para
  //     poder inspeccionar los archivos subidos;
  //   - en producción, en el perfil del usuario, que siempre es escribible
  //     (junto al ejecutable puede no serlo).
  const dataDir = isDev
    ? path.join(backendDir, 'data')
    : path.join(userDataDir, 'data');

  backend = new BackendManager({
    backendDir,
    port: BACKEND_PORT,
    userDataDir,
    dataDir,
    apiToken: API_TOKEN,
    // En desarrollo el backend escribe sus logs (uvicorn) directamente en
    // esta terminal, mezclados con los de Vite. En producción no hay
    // terminal: la salida se captura y queda en el archivo de log.
    inheritStdio: isDev,
  });

  setupIpc();
  createWindow();
  setupSmokeCheck();
  // Mostrar la UI de inmediato (no bloqueamos esperando al backend).
  // El badge de estado refleja "Conectando…" hasta que /v1/health
  // responda, y se actualiza en vivo vía el stream backend:log.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }

  // Arrancar el backend en background. Si falla, mostrar un diálogo
  // informativo pero sin bloquear la UI.
  backend.start({ timeoutMs: 30000 }).catch((err) => {
    // En smoke no mostramos el diálogo: es modal y bloquearía la verificación.
    if (process.env.PYTHOMICS_SMOKE === '1') {
      console.error('[smoke] el backend no pudo iniciarse:', err.message);
      return;
    }
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
