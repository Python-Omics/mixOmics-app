import { useProject } from '../lib/project-state';
import { ResultsPanel } from '../components/ResultsPanel';
import { useTranslate } from '../i18n';

type Props = {
  onBack: () => void;
  onRestart: () => void;
};

export function ResultsPage({ onBack, onRestart }: Props) {
  const { state, reset } = useProject();
  const t = useTranslate();

  const handleRestart = () => {
    reset();
    onRestart();
  };

  return (
    <div className="max-w-4xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-pharma-700">
            {t('results.title')}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {t('results.summaryModel')}{' '}
            <code className="font-mono text-pharma-700">
              {state.modelConfig.model_type}
            </code>{' '}
            · {t('results.summaryFile')}{' '}
            <code className="font-mono text-pharma-700">
              {state.modelConfig.filename}
            </code>{' '}
            · {t('results.summaryComponents')}{' '}
            <code className="font-mono text-pharma-700">
              {state.modelConfig.n_components}
            </code>
            {state.modelConfig.keepX !== undefined && (
              <>
                {' '}
                · {t('results.summaryKeepX')}{' '}
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
          {t('results.back')}
        </button>
        <button type="button" className="btn-ghost" onClick={handleRestart}>
          {t('results.restart')}
        </button>
      </footer>
    </div>
  );
}
