import { useProject } from '../lib/project-state';
import { ResultsPanel } from '../components/ResultsPanel';

type Props = {
  onBack: () => void;
  onRestart: () => void;
};

export function ResultsPage({ onBack, onRestart }: Props) {
  const { state, reset } = useProject();

  const handleRestart = () => {
    reset();
    onRestart();
  };

  return (
    <div className="max-w-4xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-pharma-700">
            Resultados del análisis
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Modelo:{' '}
            <code className="font-mono text-pharma-700">
              {state.modelConfig.model_type}
            </code>{' '}
            · archivo:{' '}
            <code className="font-mono text-pharma-700">
              {state.modelConfig.filename}
            </code>{' '}
            · componentes:{' '}
            <code className="font-mono text-pharma-700">
              {state.modelConfig.n_components}
            </code>
            {state.modelConfig.keepX !== undefined && (
              <>
                {' '}
                · keepX:{' '}
                <code className="font-mono text-pharma-700">
                  {state.modelConfig.keepX}
                </code>
              </>
            )}
          </p>
        </div>
      </header>

      <ResultsPanel result={state.result} />

      <footer className="flex justify-between pt-2">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Volver
        </button>
        <button type="button" className="btn-ghost" onClick={handleRestart}>
          Empezar de nuevo
        </button>
      </footer>
    </div>
  );
}