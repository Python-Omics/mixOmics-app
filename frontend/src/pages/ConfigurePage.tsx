import { useState } from 'react';
import { ModelConfigForm } from '../components/ModelConfigForm';
import { api } from '../lib/api';
import { useProject } from '../lib/project-state';
import { useTranslate } from '../i18n';

type Props = {
  onBack: () => void;
  onNext: () => void;
};

export function ConfigurePage({ onBack, onNext }: Props) {
  const { state, setResult } = useProject();
  const [isValid, setIsValid] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslate();

  const handleExecute = async () => {
    if (!isValid || executing) return;
    setExecuting(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.runModel(state.modelConfig);
      if (res.ok) {
        setResult(res.data ?? null);
        onNext();
      } else {
        setError(
          t('configure.backendError', {
            status: res.status,
            detail: res.error ? ` — ${res.error}` : '',
          }),
        );
      }
    } catch (err) {
      setError(
        t('configure.backendUnreachable', { detail: (err as Error).message }),
      );
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-pharma-700">
          {t('configure.title')}
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          {t('configure.description')}
        </p>
      </header>

      <div className="card p-6">
        <ModelConfigForm onValidChange={setIsValid} />
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2"
        >
          {error}
        </p>
      )}

      <footer className="flex justify-between pt-2">
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t('configure.back')}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleExecute}
          disabled={!isValid || executing}
        >
          {executing ? t('configure.running') : t('configure.run')}
        </button>
      </footer>
    </div>
  );
}
