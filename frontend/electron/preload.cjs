'use strict';

/**
 * Preload script — puente seguro entre UI (renderer) y Electron (main).
 *
 * Convenciones:
 *   - contextIsolation + sandbox activos (ver electron/main.cjs).
 *   - Se expone una única API `window.pyxAPI` vía contextBridge.
 *   - El renderer NO tiene acceso a Node, fs, ni ipcRenderer directamente.
 *   - Todo el tráfico HTTP al backend va por los handlers `api:request`
 *     (JSON) y `api:upload` (multipart/form-data), que hacen el fetch a
 *     127.0.0.1:8501. El renderer nunca toca el puerto.
 *   - Los streams (logs del backend) llegan por eventos IPC y se devuelven
 *     al callback; cada `onXxx()` retorna un `unsubscribe()` para limpieza.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Rutas que el usuario realmente eligio o arrastro.
 *
 * El renderer puede nombrar cualquier path y el proceso main lo leeria del
 * disco: sin esta lista, un renderer comprometido podria subir (y dejar en
 * el directorio de datos) un archivo arbitrario del sistema, por ejemplo una
 * clave SSH.
 *
 * La lista se llena **solo** con paths que pasaron por `getPathForFile`, que
 * solo devuelve una ruta real para un `File` genuino del usuario: un `File`
 * sintetizado en JavaScript devuelve cadena vacia.
 */
const resolvedPaths = new Set();

contextBridge.exposeInMainWorld('pyxAPI', {
  // --- Estado del backend ---
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),

  /**
   * Obtiene la ruta de un archivo que el usuario eligió o arrastró.
   *
   * `webUtils.getPathForFile` es la forma soportada de obtener esa ruta en
   * Electron 33: la propiedad `File.path` se eliminó en Electron 32. El
   * `File` nunca tiene que leerse entero en el renderer; el proceso main
   * abre la ruta y arma el cuerpo multipart desde el disco.
   */
  getPathForFile: (file) => {
    const path = webUtils.getPathForFile(file);
    // Queda autorizada para una sola subida.
    if (path) resolvedPaths.add(path);
    return path;
  },

  // --- Proxy HTTP al backend ---
  api: {
    request: (method, path, body) =>
      ipcRenderer.invoke('api:request', { method, path, body }),
    get: (path) =>
      ipcRenderer.invoke('api:request', { method: 'GET', path }),
    post: (path, body) =>
      ipcRenderer.invoke('api:request', { method: 'POST', path, body }),
    delete: (path) =>
      ipcRenderer.invoke('api:request', { method: 'DELETE', path }),
    // Subida de archivos: viaja como multipart/form-data (campo `file`).
    // `path` es una ruta local; `content` queda como fallback para assets
    // estáticos que no tienen una ruta que Electron pueda abrir.
    upload: (path, filename, content) => {
      if (path) {
        if (!resolvedPaths.has(path)) {
          return Promise.resolve({
            ok: false,
            status: 0,
            error: 'ruta no autorizada por el usuario',
          });
        }
        // De un solo uso: una ruta no sirve para subir el mismo archivo dos
        // veces.
        resolvedPaths.delete(path);
      }
      return ipcRenderer.invoke('api:upload', { path, filename, content });
    },
    // Figuras: el renderer pide el PNG de un job y arma un `blob:` URL con
    // el base64 que vuelve. El token compartido NO llega al renderer: lo
    // usa el proceso main, que es el único que conoce el puerto.
    getFigure: (jobId, name) =>
      ipcRenderer.invoke('api:file', { jobId, name }),
  },

  // --- Streams del subproceso ---
  onBackendLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('backend:log', listener);
    return () => ipcRenderer.removeListener('backend:log', listener);
  },
  onBackendExit: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('backend:exit', listener);
    return () => ipcRenderer.removeListener('backend:exit', listener);
  },
  onBackendError: (callback) => {
    const listener = (_event, err) => callback(err);
    ipcRenderer.on('backend:error', listener);
    return () => ipcRenderer.removeListener('backend:error', listener);
  },
});