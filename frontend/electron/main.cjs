'use strict';

/**
 * Electron main process — Pythomics desktop.
 *
 * Responsabilidades:
 *   - Crear BrowserWindow con sandbox/contextIsolation seguros.
 *   - Antes de mostrar la UI, levantar el backend FastAPI local.
 *   - Exponer IPC handlers (api:request, api:upload, api:file,
 *     backend:status, backend:restart) y forward de logs del subproceso al
 *     renderer.
 *   - Cleanup: matar el subproceso al cerrar la ventana.
 *
 * Frontera de seguridad: el renderer NUNCA habla con el puerto del backend.
 * Todo pasa por el puente IPC, y el token compartido vive acá (en el
 * proceso main), nunca en el renderer.
 */

const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { openAsBlob } = require('node:fs');
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

/**
 * Valida un identificador de job antes de construir una URL con él.
 *
 * Los identificadores que genera el backend son `job_` + hexadecimal, así
 * que el patrón es cerrado a propósito: un identificador con separadores o
 * con `..` no llega nunca a la red.
 *
 * @param {unknown} valor
 * @returns {boolean}
 */
function identificadorSeguro(valor) {
  return (
    typeof valor === 'string' &&
    valor.length > 0 &&
    valor.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(valor)
  );
}

/**
 * Valida el nombre de una figura antes de construir una URL con él.
 *
 * El nombre va al path de la URL (`/v1/files/{job_id}/{name}.png`), así que
 * no puede traer separadores ni `..`: el traversal se corta acá, antes de
 * tocar la red. El backend también valida, pero la defensa va en la
 * frontera que arma la URL.
 *
 * @param {unknown} valor
 * @returns {boolean}
 */
function nombreFiguraSeguro(valor) {
  if (typeof valor !== 'string') return false;
  if (valor.length === 0 || valor.length > 255) return false;
  if (valor.includes('..')) return false;
  return /^[A-Za-z0-9._-]+$/.test(valor);
}

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
 * Verifica la rotación del archivo de log sobre un directorio temporal.
 *
 * No toca el log real del usuario: el smoke crea su propio directorio,
 * escribe un log más grande que el tope y comprueba que queda rotado, y
 * que un log chico no se rota.
 *
 * @returns {boolean} - true si la rotación se comportó como se espera.
 */
function checkLogRotation() {
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'pythomics-log-'));
  try {
    const manager = new BackendManager({
      backendDir: '',
      userDataDir: temporal,
      inheritStdio: true,
    });
    fs.writeFileSync(manager.logPath, 'x'.repeat(6 * 1024 * 1024));

    const rotado = manager.rotateLogIfNeeded(5 * 1024 * 1024);
    const anterior = `${manager.logPath}.1`;
    const conservado = fs.existsSync(anterior);
    const nuevoVacio = !fs.existsSync(manager.logPath);

    // Un log que no llega al tope no se toca.
    const chico = new BackendManager({
      backendDir: '',
      userDataDir: temporal,
      inheritStdio: true,
    });
    fs.writeFileSync(chico.logPath, 'poco');
    const rotadoDeMas = chico.rotateLogIfNeeded(5 * 1024 * 1024);

    return rotado && conservado && nuevoVacio && !rotadoDeMas;
  } catch (err) {
    console.error('[smoke] no se pudo probar la rotación del log:', err.message);
    return false;
  } finally {
    fs.rmSync(temporal, { recursive: true, force: true });
  }
}

/**
 * Verifica el canal de figuras (`api:file`).
 *
 * El renderer nunca habla con el puerto del backend: pide la figura por el
 * puente IPC y el proceso main la baja con el token compartido. El nombre
 * de la figura va a una URL, así que se valida ANTES de construirla: nada
 * de traversal ni de separadores de ruta.
 *
 * La comprobación no necesita el backend: un nombre inválido se rechaza en
 * el proceso main, sin tocar la red.
 *
 * @returns {Promise<boolean>} - true si el canal existe y valida el nombre.
 */
async function checkFigureChannel() {
  try {
    const res = await mainWindow.webContents.executeJavaScript(
      "window.pyxAPI.api.getFigure('job_prueba', '../../etc/passwd')",
    );
    // Rechazo local: status 0 (no hubo petición) y un mensaje de error.
    return Boolean(res && res.ok === false && res.status === 0 && res.error);
  } catch (err) {
    console.error('[smoke] el canal de figuras no respondió:', err.message);
    return false;
  }
}

/**
 * Verifica el camino feliz del canal de figuras: una figura real la baja el
 * proceso main con el token compartido y vuelve al renderer como base64.
 *
 * La cadena completa es la del contrato (S27): subida del bloque, receta,
 * alineación confirmada, job, polling, figura por `api:file` y `blob:` URL
 * en el renderer.
 *
 * OJO: la CSP de `index.html` tiene `img-src 'self' data:`, y eso bloquea
 * los `blob:` URL (Chromium: "Refused to load the image 'blob:...'"). Por eso
 * esta comprobación NO carga la imagen en un `<img>`: verificaría la CSP, no
 * el canal. La CSP tiene que admitir `blob:` para que la pantalla de
 * resultados pueda mostrar las figuras.
 *
 * @returns {Promise<'ok'|'skip'|'fail'>} - `skip` si el backend no está.
 */
async function checkFigureRoundTrip() {
  const listo = await esperarBackend(60);
  if (!listo) {
    console.error('[smoke] el backend no respondió: no se prueba la figura');
    return 'skip';
  }

  const headers = { 'X-Pythomics-Token': API_TOKEN };
  const base = `http://127.0.0.1:${BACKEND_PORT}`;

  // 1) Un bloque mínimo, subido desde un directorio temporal.
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'pythomics-figura-'));
  const csv = path.join(temporal, 'bloque.csv');
  fs.writeFileSync(
    csv,
    ['sample,v1,v2,v3,v4']
      .concat(
        Array.from({ length: 8 }, (_, fila) =>
          [fila + 1, fila * 1.5, fila * -0.5, fila * 0.25, fila % 3].join(','),
        ),
      )
      .join('\n'),
  );

  let idReceta = null;
  let jobId = null;

  try {
    const form = new FormData();
    const blob = await openAsBlob(csv, { type: 'text/csv' });
    form.append('file', blob, 'bloque.csv');
    const subida = await fetch(`${base}/v1/archivos/`, {
      method: 'POST',
      body: form,
      headers,
    });
    if (!subida.ok) {
      console.error(
        '[smoke] no se pudo subir el bloque:',
        subida.status,
        await subida.text(),
      );
      return 'fail';
    }

    // 2) La receta.
    const receta = await fetch(`${base}/v1/datasets/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: [{ name: 'bloque.csv', role: 'block' }] }),
    });
    if (!receta.ok) {
      console.error('[smoke] no se pudo crear la receta:', receta.status);
      return 'fail';
    }
    idReceta = (await receta.json()).id;

    // 2b) La alineación, confirmada explícitamente por el usuario (RF-2).
    const alineacion = await fetch(`${base}/v1/datasets/${idReceta}/align/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: ['bloque.csv'], confirmed: true }),
    });
    if (!alineacion.ok) {
      console.error('[smoke] no se pudo alinear:', alineacion.status);
      return 'fail';
    }

    // 3) El job.
    const modelo = await fetch(`${base}/v1/model/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset_id: idReceta,
        model_type: 'PCA',
        n_components: 2,
        seed: 7,
      }),
    });
    if (!modelo.ok) {
      console.error('[smoke] no se pudo encolar el job:', modelo.status);
      return 'fail';
    }
    jobId = (await modelo.json()).job_id;

    // 4) El polling, hasta que el job termine.
    let job = null;
    for (let intento = 0; intento < 120; intento += 1) {
      const consulta = await fetch(`${base}/v1/jobs/${jobId}/`, { headers });
      job = await consulta.json();
      if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!job || job.status !== 'completed') {
      console.error(
        '[smoke] el job no terminó:',
        job && job.status,
        JSON.stringify(job && job.error),
      );
      return 'fail';
    }
    const figura = job.result.figures[0];
    if (!figura) {
      console.error('[smoke] el job no produjo figuras');
      return 'fail';
    }

    // 5) La figura por el canal `api:file` y el blob: URL en el renderer.
    const porCanal = await mainWindow.webContents.executeJavaScript(
      `window.pyxAPI.api.getFigure(${JSON.stringify(jobId)}, ${JSON.stringify(figura.name)})`,
    );
    if (!porCanal || !porCanal.ok || !porCanal.data) {
      console.error('[smoke] el canal de figuras no devolvió la figura');
      return 'fail';
    }
    const base64 = porCanal.data.dataBase64;
    if (!base64 || !base64.startsWith('iVBOR')) {
      console.error('[smoke] la figura no es un PNG válido');
      return 'fail';
    }
    const blobUrl = await mainWindow.webContents.executeJavaScript(
      `(() => { const bin = atob(${JSON.stringify(base64)}); ` +
        `const bytes = new Uint8Array(bin.length); ` +
        `for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i); ` +
        `return URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); })()`,
    );
    if (!blobUrl || !blobUrl.startsWith('blob:')) {
      console.error('[smoke] el renderer no pudo armar el blob: URL');
      return 'fail';
    }

    // 5b) La imagen se carga de verdad en el renderer. Esto es lo que
    // atrapa una CSP que no permita los blob: URL: el `img.onerror` salta
    // y la figura nunca se ve, aunque el canal funcione.
    const imagenCarga = await mainWindow.webContents.executeJavaScript(
      `new Promise((resolve) => {
         const img = new Image();
         img.onload = () => resolve(img.naturalWidth > 0);
         img.onerror = () => resolve(false);
         img.src = ${JSON.stringify(blobUrl)};
       })`,
    );
    if (!imagenCarga) {
      console.error('[smoke] el renderer no pudo cargar la imagen blob:');
      return 'fail';
    }

    console.log(
      `[smoke] figura del job ${jobId}: ${figura.name} ` +
        `(${base64.length} bytes base64)`,
    );
    return 'ok';
  } finally {
    // El smoke no deja basura: borra el archivo, la receta y el job.
    await limpiarPrueba(base, headers, idReceta, jobId);
    fs.rmSync(temporal, { recursive: true, force: true });
  }
}

/**
 * Borra lo que el smoke creó en el backend: el archivo, la receta y el
 * directorio del job.
 *
 * @param {string} base
 * @param {Record<string, string>} headers
 * @param {string | null} idReceta
 * @param {string | null} jobId
 * @returns {Promise<void>}
 */
async function limpiarPrueba(base, headers, idReceta, jobId) {
  try {
    await fetch(`${base}/v1/archivos/?nombre_archivo=bloque.csv`, {
      method: 'DELETE',
      headers,
    });
    if (idReceta) {
      await fetch(`${base}/v1/datasets/${idReceta}/`, {
        method: 'DELETE',
        headers,
      });
    }
    if (jobId && backendDataDir) {
      fs.rmSync(path.join(backendDataDir, 'jobs', jobId), {
        recursive: true,
        force: true,
      });
    }
  } catch (err) {
    console.error('[smoke] no se pudo limpiar la prueba:', err.message);
  }
}

/**
 * Espera a que el backend responda el healthcheck.
 *
 * @param {number} intentos
 * @returns {Promise<boolean>}
 */
async function esperarBackend(intentos) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/v1/health`, {
        headers: { 'X-Pythomics-Token': API_TOKEN },
      });
      if (res.ok) return true;
    } catch {
      // todavia no esta levantado
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

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
      ['el log se rota al superar el tope', checkLogRotation()],
      ['el canal de figuras valida el nombre', await checkFigureChannel()],
    ];

    // El camino feliz de las figuras necesita el backend: si no está, la
    // comprobación se omite (y se dice) en vez de dar un falso negativo.
    const figura = await checkFigureRoundTrip();
    if (figura === 'skip') {
      console.log(
        '[smoke] OMITIDA  el canal de figuras entrega la figura (el backend no respondió)',
      );
    } else {
      checks.push(['el canal de figuras entrega la figura', figura === 'ok']);
    }

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

    // El backend se detiene antes de salir: si queda vivo, ocupa el puerto
    // 8501 y la próxima corrida del smoke no puede arrancar el suyo.
    if (backend) await backend.stop();

    app.exit(ok ? 0 : 1);
  });
}

let mainWindow = null;
/** @type {BackendManager | null} */
let backend = null;
/**
 * Directorio de datos del backend.
 *
 * Lo usa el smoke para borrar el directorio del job de prueba: es el
 * directorio del propio backend (`<data>/jobs/<job_id>`), no un dato del
 * usuario.
 */
let backendDataDir = null;

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
    const filePath = (payload && payload.path) || '';
    const filename = (payload && payload.filename) || '';
    const content =
      payload && typeof payload.content === 'string' ? payload.content : '';

    // El canal de subida tiene un único destino: la ingesta de archivos.
    const apiPath = '/v1/archivos/';
    const url = `http://127.0.0.1:${BACKEND_PORT}${apiPath}`;
    try {
      const form = new FormData();
      // El MIME se deriva de la extensión: el dropzone acepta .csv y .tsv
      // (RB-14), y mandarlos todos como text/csv sería incorrecto para
      // los tab-separados.
      const mime = filename.toLowerCase().endsWith('.tsv')
        ? 'text/tab-separated-values'
        : 'text/csv';

      // `openAsBlob` devuelve un Blob backed por el archivo: fetch arma el
      // cuerpo multipart leyéndolo del disco, sin copiarlo entero al heap.
      // Si no hay ruta (assets estáticos), se conserva el fallback de
      // contenido que enviaba el renderer.
      const blob = filePath
        ? await openAsBlob(filePath, { type: mime })
        : new Blob([content], { type: mime });
      form.append('file', blob, filename);
      // OJO: NO setear Content-Type a mano. fetch lo arma con el boundary
      // correcto; si se define a mano, el boundary queda mal y FastAPI
      // rechaza el archivo.
      const res = await fetch(url, {
        method: 'POST',
        body: form,
        headers: { 'X-Pythomics-Token': API_TOKEN },
      });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await res.json().catch(() => null)
        : await res.text();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  });

  // Canal de las figuras (S27).
  //
  // `api:request` devuelve JSON o texto: una figura es binaria, así que
  // viaja por su propio canal. El proceso main es el único que conoce el
  // puerto y el token compartido; el renderer solo recibe el PNG en base64
  // y arma un `blob:` URL con él.
  ipcMain.handle('api:file', async (_event, payload) => {
    const jobId = (payload && payload.jobId) || '';
    const name = (payload && payload.name) || '';

    // El nombre va a una URL: se valida antes de construirla.
    if (!identificadorSeguro(jobId) || !nombreFiguraSeguro(name)) {
      return {
        ok: false,
        status: 0,
        error: 'identificador de job o nombre de figura inválido',
      };
    }

    const url =
      `http://127.0.0.1:${BACKEND_PORT}` +
      `/v1/files/${encodeURIComponent(jobId)}/${encodeURIComponent(name)}.png`;

    try {
      const res = await fetch(url, {
        headers: { 'X-Pythomics-Token': API_TOKEN },
      });
      const contentType = res.headers.get('content-type') || '';

      if (!res.ok) {
        // El backend responde el sobre de error en JSON: se reenvía tal
        // cual para que el renderer lo traduzca por `message_key`.
        const data = contentType.includes('application/json')
          ? await res.json().catch(() => null)
          : await res.text();
        return { ok: false, status: res.status, data };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        ok: true,
        status: res.status,
        data: {
          mime: contentType || 'image/png',
          dataBase64: buffer.toString('base64'),
        },
      };
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
  backendDataDir = dataDir;

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
