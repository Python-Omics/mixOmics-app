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

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pyxAPI', {
  // --- Estado del backend ---
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),

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
    upload: (path, filename, content) =>
      ipcRenderer.invoke('api:upload', { path, filename, content }),
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