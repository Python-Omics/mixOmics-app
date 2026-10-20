import { ChartIcon, SettingsIcon } from '../components/icons';

type Props = {
  onStart: () => void;
  onOpenSettings: () => void;
};

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
    </div>
  );
}
