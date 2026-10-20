/**
 * Paletas de color disponibles.
 *
 * Cada tema expone 10 shades (50→900). Los 5 colores base de la paleta
 * médica se mapean directo a 50/100/200/400/700; los intermedios (300, 500,
 * 600, 800, 900) se derivan por interpolación para completar la escala de
 * Tailwind sin introducir colores fuera de la paleta.
 *
 * El shade 500 usa factor de oscurecimiento 0.72 sobre el 400. Esto NO es
 * arbitrario: garantiza que `text-white` sobre `bg-pharma-500` (botón
 * primary) cumpla WCAG AA (≥4.5:1). Con 0.88 fallaba en 2 de 4 paletas.
 *
 * Ver `verify-theme-contrast.js` para los ratios exactos de cada tema.
 */

export type ThemeId =
  | 'pharmacy-fresh'
  | 'sterile-aqua'
  | 'minted-hygiene'
  | 'soft-bandage'
  | 'immunity-citrus';

export type Theme = {
  id: ThemeId;
  name: string;
  /** Descripción corta para el selector */
  description: string;
  /** Colores base de la paleta médica para el swatch preview */
  swatch: string[];
};

export const THEMES: Theme[] = [
  {
    id: 'pharmacy-fresh',
    name: 'Pharmacy Fresh',
    description: 'Verde vibrante. Limpieza clínica, el tema por defecto.',
    swatch: ['#F9FFFB', '#DFF7E8', '#9BE7B1', '#2CB67D', '#1F3D2C'] as string[],
  },
  {
    id: 'sterile-aqua',
    name: 'Sterile Aqua',
    description: 'Cian refreshing. Estéril, laboratorio, agua.',
    swatch: ['#EAF7FB', '#BFEAF2', '#63C9D6', '#1E7F8C', '#20343A'] as string[],
  },
  {
    id: 'minted-hygiene',
    name: 'Minted Hygiene',
    description: 'Verde suave con toque turquesa. Cuidado, bienestar.',
    swatch: ['#F2FFFB', '#CFF7EA', '#7FE3C6', '#2AAE8A', '#124D41'] as string[],
  },
  {
    id: 'soft-bandage',
    name: 'Soft Bandage',
    description: 'Beis cálido. Confort y cuidado.',
    swatch: ['#FFF8F2', '#F6E3D6', '#D9B7A7', '#9C6B5D', '#3D2A25'] as string[],
  },
  {
    id: 'immunity-citrus',
    name: 'Immunity Citrus',
    description: 'Lima y ámbar. Energía, inmunidad,quisitions.',
    swatch: ['#F7FFF4', '#DFF7C9', '#A6E65A', '#FFB703', '#2B3A1F'] as string[],
  },
];

export const DEFAULT_THEME_ID: ThemeId = 'pharmacy-fresh';

export const THEME_BY_ID: Record<ThemeId, Theme> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
) as Record<ThemeId, Theme>;

/**
 * Temas anunciados pero aún no disponibles.
 * Telehealth Night requiere dark mode real (separar los roles de
 * `pharma-700` entre "fondo de sidebar" y "texto principal"), lo que
 * implica refactorizar Sidebar y varios componentes. Ver DECISIONS.md.
 */
export const UPCOMING_THEMES = [
  {
    name: 'Telehealth Night',
    description: 'Tema oscuro para sesiones nocturnas. Próximamente.',
    swatch: ['#0B1020', '#233B7A', '#5B8CFF', '#BFD3FF', '#EAF2FF'] as const,
  },
];