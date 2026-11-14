import { THEMES, UPCOMING_THEMES, type ThemeId } from '../lib/themes';
import { useTranslate } from '../i18n';

type Props = {
  theme: ThemeId;
  onChange: (id: ThemeId) => void;
};

/** Swatch circular con los 5 colores de la paleta, superpuestos. */
function Palette({ colors, dim }: { colors: readonly string[]; dim?: boolean }) {
  return (
    <span
      className={`flex shrink-0 -space-x-1 ${dim ? 'opacity-60' : ''}`}
      aria-hidden="true"
    >
      {colors.map((c, i) => (
        <span
          key={i}
          className="w-5 h-5 rounded-full ring-2 ring-white"
          style={{ backgroundColor: c }}
        />
      ))}
    </span>
  );
}

/**
 * Selector de tema de colores.
 *
 * Radio-cards: cada opción muestra la paleta completa y el nombre. Sin
 * descripciones — el color habla por sí mismo.
 *
 * Accesibilidad: `role="radiogroup"` con `role="radio"` + `aria-checked`.
 */
export function ThemeSelector({ theme, onChange }: Props) {
  const t = useTranslate();

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.groupLabel', { count: THEMES.length })}
      className="space-y-2"
    >
      {THEMES.map((def) => {
        const selected = def.id === theme;
        return (
          <button
            key={def.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={def.name}
            onClick={() => onChange(def.id)}
            className={`w-full flex items-center gap-3 rounded-lg border-2 px-3 py-2.5 transition-colors ${
              selected
                ? 'border-pharma-500 bg-pharma-50'
                : 'border-slate-200 bg-white hover:border-pharma-300 hover:bg-pharma-50'
            }`}
          >
            <Palette colors={def.swatch} />

            <span className="flex-1 text-left text-sm font-medium text-pharma-700">
              {def.name}
            </span>

            {selected && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wide text-white bg-pharma-500 rounded-full px-2 py-0.5"
                aria-hidden="true"
              >
                {t('theme.active')}
              </span>
            )}
          </button>
        );
      })}

      {/* Temas anunciados pero no disponibles todavía */}
      {UPCOMING_THEMES.map((upcoming) => (
        <div
          key={upcoming.name}
          className="w-full flex items-center gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 opacity-60"
        >
          <Palette colors={upcoming.swatch} dim />
          <span className="flex-1 text-left text-sm font-medium text-slate-600">
            {upcoming.name}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-200 rounded-full px-2 py-0.5">
            {t('theme.upcoming')}
          </span>
        </div>
      ))}
    </div>
  );
}