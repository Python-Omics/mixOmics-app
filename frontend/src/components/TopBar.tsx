import type { Step } from '../lib/types';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { QuestionIcon, ChartIcon } from './icons';

type Props = {
  currentStep: Step;
  onOpenTutorial: () => void;
  onOpenExampleDatasets: () => void;
};

/** Títulos de cada paso: el copy vive en el catálogo de mensajes. */
const STEP_TITLES: Record<Step, MessageKey> = {
  load: 'topbar.step.load',
  configure: 'topbar.step.configure',
  results: 'topbar.step.results',
};

export function TopBar({ currentStep, onOpenTutorial, onOpenExampleDatasets }: Props) {
  const t = useTranslate();

  return (
    <header className="h-14 bg-white border-b border-pharma-200 flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-700">
          {t(STEP_TITLES[currentStep])}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenExampleDatasets}
          className="btn-secondary"
          aria-label={t('topbar.datasetsLabel')}
        >
          <ChartIcon className="w-4 h-4" />
          <span>{t('topbar.datasets')}</span>
        </button>
        <button
          type="button"
          onClick={onOpenTutorial}
          className="btn-secondary"
          aria-label={t('topbar.tutorialLabel')}
        >
          <QuestionIcon className="w-4 h-4" />
          <span>{t('topbar.tutorial')}</span>
        </button>
      </div>
    </header>
  );
}