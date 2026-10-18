import type { Step } from '../lib/types';
import { CheckIcon, SettingsIcon } from './icons';

type StepDef = { id: Step; label: string };

type Props = {
  steps: StepDef[];
  currentStep: Step;
  onSelect: (step: Step) => void;
  onOpenSettings: () => void;
};

export function Sidebar({ steps, currentStep, onSelect, onOpenSettings }: Props) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <aside className="w-64 bg-pharma-700 text-white flex flex-col shrink-0">
      <div className="p-6 border-b border-pharma-900">
        <h1 className="text-xl font-bold tracking-tight">Pythomics</h1>
        <p className="text-xs text-pharma-200 mt-1">
          Análisis multi-ómico · POC v0.1.0
        </p>
      </div>

      <nav className="flex-1 p-4" aria-label="Pasos del flujo">
        <ol className="space-y-2">
          {steps.map((s, idx) => {
            const active = s.id === currentStep;
            const completed = idx < currentIndex;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                    active
                      ? 'bg-pharma-500 text-white shadow-sm'
                      : completed
                        ? 'text-pharma-100 hover:bg-pharma-800 hover:text-white'
                        : 'text-pharma-200 hover:bg-pharma-800 hover:text-white'
                  }`}
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      active
                        ? 'bg-white text-pharma-700'
                        : completed
                          ? 'bg-pharma-400 text-white'
                          : 'bg-pharma-800 text-pharma-200'
                    }`}
                    aria-hidden="true"
                  >
                    {completed ? <CheckIcon className="w-4 h-4" /> : idx + 1}
                  </span>
                  <span className="text-sm font-medium">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="p-4 border-t border-pharma-900">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-pharma-200 hover:bg-pharma-800 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma-300"
          aria-label="Abrir configuración"
        >
          <SettingsIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Configuración</span>
        </button>
      </div>
    </aside>
  );
}