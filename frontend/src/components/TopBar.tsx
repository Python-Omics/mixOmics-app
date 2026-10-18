import type { Step } from '../lib/types';
import { ChevronUpIcon, ChevronDownIcon, QuestionIcon, ChartIcon } from './icons';

type Props = {
  currentStep: Step;
  onToggleLogs: () => void;
  showLogs: boolean;
  onOpenTutorial: () => void;
  onOpenExampleDatasets: () => void;
};

const STEP_TITLES: Record<Step, string> = {
  load: 'Paso 1 · Cargar datos',
  configure: 'Paso 2 · Configurar modelo',
  results: 'Paso 3 · Resultados',
};

export function TopBar({
  currentStep,
  onToggleLogs,
  showLogs,
  onOpenTutorial,
  onOpenExampleDatasets,
}: Props) {
  return (
    <header className="h-14 bg-white border-b border-pharma-200 flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-700">
          {STEP_TITLES[currentStep]}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenExampleDatasets}
          className="btn-secondary"
          aria-label="Probar con dataset de ejemplo"
        >
          <ChartIcon className="w-4 h-4" />
          <span>Probar datasets</span>
        </button>
        <button
          type="button"
          onClick={onOpenTutorial}
          className="btn-secondary"
          aria-label="Abrir tutorial"
        >
          <QuestionIcon className="w-4 h-4" />
          <span>Tutorial</span>
        </button>
        <button
          type="button"
          onClick={onToggleLogs}
          className="btn-secondary"
          aria-label={showLogs ? 'Ocultar logs del backend' : 'Mostrar logs del backend'}
          aria-pressed={showLogs}
        >
          {showLogs ? (
            <ChevronDownIcon className="w-3 h-3" />
          ) : (
            <ChevronUpIcon className="w-3 h-3" />
          )}
          {showLogs ? 'Ocultar logs' : 'Ver logs'}
        </button>
      </div>
    </header>
  );
}