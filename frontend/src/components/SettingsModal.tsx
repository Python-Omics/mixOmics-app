import { useEffect, useRef, useState } from 'react';
import { CloseIcon, PaletteIcon } from './icons';
import { ThemeSelector } from './ThemeSelector';
import { useTheme } from '../lib/use-theme';

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Secciones del panel de configuración. Solo una activa por ahora. */
const SECTIONS = [
  { id: 'personalization', label: 'Personalización', icon: PaletteIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * Modal de configuración — panel horizontal.
 *
 * Layout: sidebar de secciones a la izquierda, contenido de la sección
 * seleccionada a la derecha. Escala a más secciones sin tocar el layout
 * (API key de LLM, backend, privacidad, etc.).
 *
 * Accesibilidad:
 *   - role="dialog" + aria-modal + aria-labelledby
 *   - Cierre con Escape, backdrop clickeable, focus inicial en cerrar
 *   - Sidebar como <nav> con aria-current en la sección activa
 */
export function SettingsModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<SectionId>('personalization');

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

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const ActiveIcon = active.icon;

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

      {/* Panel horizontal: sidebar + contenido */}
      <div className="relative w-full max-w-3xl bg-white rounded-lg shadow-xl border border-slate-200 flex overflow-hidden">
        {/* ─── Sidebar de secciones ─────────────────────────────────────── */}
        <nav
          className="w-52 shrink-0 bg-pharma-700 p-3 flex flex-col"
          aria-label="Secciones de configuración"
        >
          <p className="px-3 pt-1 pb-3 text-[10px] font-semibold uppercase tracking-wider text-pharma-100">
            Secciones
          </p>
          <ul className="space-y-1">
            {SECTIONS.map((s) => {
              const isActive = s.id === section;
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSection(s.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                      isActive
                        ? 'bg-pharma-500 text-white font-medium'
                        : 'text-pharma-100 hover:bg-pharma-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Espacio para futuras secciones (API key, backend, etc.) */}
          <div className="mt-auto pt-4 px-3 border-t border-pharma-800">
            <p className="text-[10px] text-pharma-200 leading-relaxed">
              Más secciones próximamente.
            </p>
          </div>
        </nav>

        {/* ─── Contenido ───────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 max-h-[80vh]">
          {/* Header del panel */}
          <div className="flex items-start justify-between gap-4 p-5 pb-3 border-b border-slate-200 shrink-0">
            <h2
              id="settings-title"
              className="text-base font-semibold text-pharma-700"
            >
              Configuración
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="btn-ghost text-slate-500 hover:text-slate-700 shrink-0"
              aria-label="Cerrar configuración"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Cuerpo scrolleable */}
          <div className="flex-1 overflow-y-auto p-5">
            {active.id === 'personalization' && (
              <section aria-label="Personalización">
                <div className="flex items-center gap-2.5 mb-4">
                  <ActiveIcon className="w-4 h-4 text-pharma-500 shrink-0" />
                  <h3 className="text-sm font-semibold text-pharma-700">
                    {active.label}
                  </h3>
                </div>
                <p className="text-xs font-medium text-slate-700 mb-3">
                  Tema de colores
                </p>
                <ThemeSelector theme={theme} onChange={setTheme} />
              </section>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end p-4 px-5 border-t border-slate-200 shrink-0">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}