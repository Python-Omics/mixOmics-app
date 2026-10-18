import { useEffect, useRef } from 'react';
import { CloseIcon } from './icons';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Modal de configuración.
 *
 * Por ahora es un placeholder vacío (no hay ajustes que cambiar).
 * La UI ya está pensada para alojar futuras opciones: API key de LLM
 * (BYOK), configuración del backend, privacidad, etc.
 *
 * Accesibilidad:
 *   - role="dialog" + aria-modal
 *   - aria-labelledby apunta al título
 *   - Cierre con Escape
 *   - Backdrop clickeable cierra
 *   - Focus inicial en el botón de cerrar
 */
export function SettingsModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Foco inicial en el botón de cerrar (accesibilidad)
    closeRef.current?.focus();

    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      {/* Backdrop clickeable */}
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Card del modal */}
      <div className="relative card w-full max-w-md p-6 bg-white shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <h2
            id="settings-title"
            className="text-lg font-semibold text-pharma-700"
          >
            Configuración
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn-ghost text-slate-500 hover:text-slate-700"
            aria-label="Cerrar configuración"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="text-sm text-slate-600 space-y-3">
          <p>Por ahora no hay opciones que cambiar.</p>
          <p className="text-slate-500 text-xs pt-2">
            En futuras versiones vas a poder:
          </p>
          <ul className="text-xs text-slate-500 space-y-1 pl-4 list-disc">
            <li>Cargar tu API key de un proveedor de IA (BYOK)</li>
            <li>Otras configuraciones...</li>
          </ul>
        </div>

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
