import { BiologyBand } from '../components/BiologyBand';
import { ChartIcon, SettingsIcon } from '../components/icons';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';

type Props = {
  onStart: () => void;
  onOpenSettings: () => void;
};

/**
 * Candidatos visibles en la franja de roadmap del pie de Inicio.
 *
 * Son claves de mensaje, no literales: el copy vive en el catálogo y el
 * `satisfies` convierte un typo en un error de TypeScript.
 */
const ROADMAP_KEYS = [
  'home.roadmap.resume',
  'home.roadmap.privacy',
  'home.roadmap.projects',
  'home.roadmap.docs',
  'home.roadmap.report',
  'home.roadmap.github',
] as const satisfies readonly MessageKey[];

/**
 * Pantalla de Inicio — punto de entrada a la app.
 *
 * Es de pantalla completa y sin el sidebar de pasos: acá todavía no se ve el
 * pipeline. El header conserva el acceso a Configuración para que siga siendo
 * alcanzable desde esta pantalla (el otro punto de entrada vive en el Sidebar).
 *
 * Accesibilidad:
 *   - un solo <h1> por pantalla (aquí, el nombre de la app)
 *   - skip link a #main-content
 *   - el CTA es un <button> real con ícono decorativo (aria-hidden)
 *   - la banda de figuras es decorativa: va con aria-hidden y no aporta
 *     texto al lector de pantalla
 *
 * Candidatos para próximas iteraciones de esta pantalla, en orden de valor:
 *   1. Reanudar último análisis   — patrón "continuar donde lo dejaste";
 *      hoy no existe en ninguna pantalla.
 *   2. Datasets de ejemplo        — ya implementado (ExampleDatasetsModal), solo
 *      falta el disparador desde acá. Cierra el hueco de RNF-U-2: sin un CSV
 *      propio, el usuario no tiene camino hacia adelante.
 *   3. Nota de privacidad local   — "los datos no salen del equipo". Costo
 *      cero y diferenciador frente a las herramientas cloud.
 *   4. Gestión de proyectos       — depende de que el backend persista.
 *   5. Tutorial y documentación   — hoy solo se abre desde el TopBar del pipeline.
 *   6. Reportar un problema       — abre un issue; mejor conversión que un
 *      link crudo a la organización.
 *
 * La franja <footer> los muestra como texto plano, sin hover ni cursor: no son
 * interactivos todavía y presentarlos como botones sería mentir sobre el estado.
 */
export function HomePage({ onStart, onOpenSettings }: Props) {
  const t = useTranslate();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-pharma-50">
      <a href="#main-content" className="skip-link">
        {t('app.skipToContent')}
      </a>

      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-pharma-200 shrink-0">
        <h1 className="text-xl font-bold tracking-tight">Pythomics</h1>

        <button
          type="button"
          onClick={onOpenSettings}
          className="btn-secondary"
          aria-label={t('home.openSettings')}
        >
          <SettingsIcon className="w-4 h-4" />
          <span>{t('home.settings')}</span>
        </button>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        aria-label={t('app.mainContent')}
        className="flex-1 flex flex-col overflow-auto p-6"
      >
        {/*
         * El contenido va en un bloque con `my-auto` (y no con
         * `justify-center`) para que siga centrado cuando sobra alto y
         * siga siendo alcanzable con el scroll cuando falta: con
         * `justify-content` el excedente superior se corta y no se puede
         * recorrer.
         */}
        <div className="my-auto flex w-full flex-col items-center gap-7">
          {/*
           * Banda decorativa de tres paneles científicos (PCA, doble
           * circos plot, heat map). Es decorativa —va con `aria-hidden`— y usa
           * todo el ancho disponible; el copy y el CTA quedan abajo, en un
           * bloque angosto y centrado.
           */}
          <BiologyBand />

          <div className="w-full max-w-2xl text-center space-y-8">
            <p className="text-xl text-slate-600 leading-relaxed">
              {t('home.tagline')}
            </p>

            <button
              type="button"
              onClick={onStart}
              className="btn-primary text-base px-6 py-3"
            >
              <ChartIcon className="w-5 h-5" />
              <span>{t('home.cta')}</span>
            </button>
          </div>
        </div>
      </main>

      {/*
       * Franja de roadmap. Es texto informativo, no controles: la lista se
       * completa a medida que se implementen y después se puede quitar entera.
       */}
      <footer className="shrink-0 border-t border-pharma-200 bg-white px-6 py-5">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('home.roadmap.title')}
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm text-slate-600 sm:grid-cols-2">
            {ROADMAP_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
