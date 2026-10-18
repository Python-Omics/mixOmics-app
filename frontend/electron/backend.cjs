'use strict';

/**
 * BackendManager — spawn del backend FastAPI local (uvicorn en :8501).
 *
 * Responsabilidades:
 *   - Detectar Python (python3 / python, o venv en backend/.venv/).
 *   - Lanzar `python main.py` como subproceso con cwd en backend/.
 *   - Esperar a que /v1/health responda 200 (polling, timeout 30s).
 *   - Capturar stdout/stderr, escribirlos a un archivo de log
 *     y emitirlos vía EventEmitter para que la UI los muestre.
 *   - Cleanup en stop() con SIGTERM y fallback SIGKILL.
 */

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

class BackendManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.backendDir - directorio donde vive main.py
   * @param {number} [opts.port=8501]
   * @param {string} opts.userDataDir - directorio para el log file
   */
  constructor({ backendDir, port = 8501, userDataDir }) {
    super();
    this.backendDir = backendDir;
    this.port = port;
    this.userDataDir = userDataDir;
    this.logPath = path.join(userDataDir, 'backend.log');
    /** @type {import('node:child_process').ChildProcess | null} */
    this.process = null;
    this.startError = null;
  }

  /**
   * Decide qué binario de Python invocar.
   * Prioriza un venv local (backend/.venv) si existe; si no, usa el del sistema.
   */
  resolvePythonCommand() {
    const isWindows = process.platform === 'win32';
    const venvPython = isWindows
      ? path.join(this.backendDir, '.venv', 'Scripts', 'python.exe')
      : path.join(this.backendDir, '.venv', 'bin', 'python');

    if (fs.existsSync(venvPython)) {
      return { command: venvPython, args: ['main.py'], source: 'venv' };
    }

    const systemPython = isWindows ? 'python' : 'python3';
    return { command: systemPython, args: ['main.py'], source: 'system' };
  }

  /**
   * Inicia el subproceso y espera a que /v1/health responda 200.
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=30000]
   */
  async start({ timeoutMs = 30000 } = {}) {
    if (this.process) {
      throw new Error('El backend ya está en ejecución');
    }

    fs.mkdirSync(this.userDataDir, { recursive: true });
    const logStream = fs.createWriteStream(this.logPath, { flags: 'a' });

    const header = `\n===== Pythomics backend start @ ${new Date().toISOString()} =====\n`;
    logStream.write(header);

    const { command, args, source } = this.resolvePythonCommand();
    this.emit('log', {
      stream: 'system',
      text: `[manager] Python: ${command} (source=${source})\n`,
      timestamp: Date.now(),
    });

    let proc;
    try {
      proc = spawn(command, args, {
        cwd: this.backendDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1', // fuerza flush para ver logs en tiempo real
        },
      });
    } catch (err) {
      this.startError = err.message;
      this.emit('error', { message: err.message });
      throw err;
    }

    this.process = proc;

    proc.stdout.on('data', (chunk) => this._handleStream('stdout', chunk, logStream));
    proc.stderr.on('data', (chunk) => this._handleStream('stderr', chunk, logStream));

    proc.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      this.process = null;
    });

    proc.on('error', (err) => {
      // Por ejemplo: ENOENT si no hay Python
      this.startError = err.message;
      this.emit('error', { message: err.message });
    });

    // Esperar readiness con manejo de timeout
    try {
      await this.waitForReady({ timeoutMs });
    } catch (err) {
      // Dejar que el caller decida qué hacer, pero no matar el subproceso
      // (puede que arranque más tarde y se conecte solo).
      this.emit('log', {
        stream: 'system',
        text: `[manager] Advertencia: ${err.message}\n`,
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  _handleStream(stream, chunk, logStream) {
    const text = chunk.toString();
    logStream.write(text);
    this.emit('log', { stream, text, timestamp: Date.now() });
  }

  /**
   * Polling a http://127.0.0.1:{port}/v1/health hasta 200 o timeout.
   */
  waitForReady({ timeoutMs = 30000, intervalMs = 250 } = {}) {
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const tryOnce = () => {
        if (this.process === null && !this.startError) {
          return reject(new Error('El subproceso del backend terminó antes de estar listo'));
        }

        if (Date.now() - start > timeoutMs) {
          return reject(new Error(
            `Backend no respondió en ${timeoutMs}ms (http://127.0.0.1:${this.port}/v1/health). ` +
            `Revisá el log en: ${this.logPath}`,
          ));
        }

        const req = http.get(
          {
            hostname: '127.0.0.1',
            port: this.port,
            path: '/v1/health',
            timeout: 1000,
          },
          (res) => {
            res.resume();
            if (res.statusCode === 200) return resolve();
            setTimeout(tryOnce, intervalMs);
          },
        );
        req.on('error', () => setTimeout(tryOnce, intervalMs));
        req.on('timeout', () => req.destroy());
      };
      tryOnce();
    });
  }

  /**
   * Mata el subproceso. SIGTERM primero, SIGKILL si no responde.
   */
  async stop({ timeoutMs = 5000 } = {}) {
    if (!this.process) return;

    const proc = this.process;
    this.process = null;

    return new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* noop */ }
        resolve();
      }, timeoutMs);

      proc.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      try { proc.kill('SIGTERM'); } catch { /* noop */ }
    });
  }
}

module.exports = { BackendManager };