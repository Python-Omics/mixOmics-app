import { useBackendStatus } from '../lib/use-backend-status';

export type BackendState = 'checking' | 'online' | 'offline' | 'error';

const PALETTE: Record<
  BackendState,
  { dot: string; text: string; label: string }
> = {
  checking: { dot: 'bg-slate-300', text: 'text-slate-500', label: 'Conectando…' },
  online: { dot: 'bg-green-500', text: 'text-green-700', label: 'Backend en línea' },
  offline: { dot: 'bg-slate-300', text: 'text-slate-500', label: 'Sin conexión' },
  error: { dot: 'bg-red-500', text: 'text-red-700', label: 'Backend con error' },
};

export function BackendStatusBadge() {
  const { status, lastError } = useBackendStatus();

  let state: BackendState = 'checking';
  let detail: string | undefined;

  if (status) {
    if (status.startError) {
      state = 'error';
      detail = `Error al iniciar: ${status.startError}`;
    } else if (status.running) {
      state = 'online';
      detail = `Escuchando en :${status.port}`;
    } else {
      state = 'offline';
      detail = status.logPath ? `Log: ${status.logPath}` : undefined;
    }
  }

  if (lastError) {
    state = 'error';
    detail = lastError.message;
  }

  const p = PALETTE[state];

  return (
    <div
      className="flex items-center gap-2 text-xs"
      role="status"
      aria-live="polite"
      title={detail}
    >
      <span className={`w-2 h-2 rounded-full ${p.dot}`} aria-hidden="true" />
      <span className={`font-medium ${p.text}`}>{p.label}</span>
    </div>
  );
}