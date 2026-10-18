import { useEffect, useRef } from 'react';
import { useBackendStatus } from '../lib/use-backend-status';
import { CloseIcon } from './icons';

type Props = {
  onClose: () => void;
};

/**
 * Panel inferior con los logs del subproceso backend (stdout/stderr en vivo).
 * Auto-scroll al final cuando llegan nuevos logs.
 */
export function LogPanel({ onClose }: Props) {
  const { logs, clearLogs } = useBackendStatus();
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último log
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <section
      className="h-56 bg-pharma-700 text-pharma-100 border-t border-pharma-900 flex flex-col shrink-0"
      aria-label="Logs del backend"
    >
      <div className="flex justify-between items-center px-4 py-2 border-b border-pharma-900">
        <h2 className="text-xs font-semibold uppercase tracking-wide">
          Logs del backend · {logs.length} entrada{logs.length === 1 ? '' : 's'}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearLogs}
            className="text-pharma-200 hover:text-white text-xs px-2 py-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma-300"
            aria-label="Limpiar logs"
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-pharma-200 hover:text-white px-2 py-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma-300"
            aria-label="Cerrar panel de logs"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed space-y-0.5"
      >
        {logs.length === 0 ? (
          <p className="text-pharma-300">— sin logs aún —</p>
        ) : (
          logs.map((entry, i) => (
            <div
              key={i}
              className={
                entry.stream === 'stderr'
                  ? 'text-red-300'
                  : entry.stream === 'system'
                    ? 'text-amber-300'
                    : 'text-pharma-100'
              }
            >
              <span className="text-slate-500 mr-2 select-none">
                {new Date(entry.timestamp).toLocaleTimeString('es-CL')}
              </span>
              {entry.text}
            </div>
          ))
        )}
      </div>
    </section>
  );
}