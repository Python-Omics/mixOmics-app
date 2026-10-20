import { ChartIcon, SettingsIcon } from '../components/icons';

type Props = {
  onStart: () => void;
  onOpenSettings: () => void;
};

/** Candidatos visibles en la franja de roadmap del pie de Inicio. */
const ROADMAP = [
    '¿Reanudar último análisis?',
    '¿Nota de privacidad local?',
    '¿Gestión de proyectos?',
    '¿Tutorial y documentación?',
    '¿Reportar un problema?',
    '¿Enlace a la organización con repositorio de app y librería core?'
];

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
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-pharma-50">
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-pharma-200 shrink-0">
        <h1 className="text-xl font-bold tracking-tight">Pythomics</h1>

        <button
          type="button"
          onClick={onOpenSettings}
          className="btn-secondary"
          aria-label="Abrir configuración"
        >
          <SettingsIcon className="w-4 h-4" />
          <span>Configuración</span>
        </button>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        aria-label="Contenido principal"
        className="flex-1 flex items-center justify-center overflow-auto p-6"
      >
        <div className="max-w-2xl text-center space-y-8">
          <p className="text-xl text-slate-600 leading-relaxed">
            Análisis multi-ómico local para biólogos e investigadores.
            Más opciones en esta pantalla próximamente.
          </p>

          <button
            type="button"
            onClick={onStart}
            className="btn-primary text-base px-6 py-3"
          >
            <ChartIcon className="w-5 h-5" />
            <span>Iniciar integración multiómica</span>
          </button>
        </div>
      </main>

      {/*
       * Franja de roadmap. Es texto informativo, no controles: la lista se
       * completa a medida que se implementen y después se puede quitar entera.
       */}
      <footer className="shrink-0 border-t border-pharma-200 bg-white px-6 py-5">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Próximamente en Inicio
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm text-slate-600 sm:grid-cols-2">
            {ROADMAP.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
