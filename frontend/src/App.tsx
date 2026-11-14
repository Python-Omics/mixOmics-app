import { useState } from 'react';
import { ProjectProvider } from './lib/project-state';
import { useTranslate } from './i18n';
import type { MessageKey } from './i18n/messages';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { HomePage } from './pages/HomePage';
import { LoadPage } from './pages/LoadPage';
import { ConfigurePage } from './pages/ConfigurePage';
import { ResultsPage } from './pages/ResultsPage';
import { SettingsModal } from './components/SettingsModal';
import { TutorialModal } from './components/TutorialModal';
import { ExampleDatasetsModal } from './components/ExampleDatasetsModal';
import type { Screen, Step } from './lib/types';

/**
 * Pasos del pipeline. El texto visible vive en el catálogo de mensajes:
 * cada paso apunta a su clave, no a un literal.
 */
const STEPS: Array<{ id: Step; labelKey: MessageKey }> = [
  { id: 'load', labelKey: 'nav.load' },
  { id: 'configure', labelKey: 'nav.configure' },
  { id: 'results', labelKey: 'nav.results' },
];

function AppShell() {
  const t = useTranslate();
  const [screen, setScreen] = useState<Screen>('home');
  const [step, setStep] = useState<Step>('load');
  const [showSettings, setShowSettings] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showExampleDatasets, setShowExampleDatasets] = useState(false);

  return (
    <>
      {screen === 'home' ? (
        <HomePage
          onStart={() => setScreen('pipeline')}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <div className="flex h-screen w-screen overflow-hidden bg-pharma-50">
          <a href="#main-content" className="skip-link">
            {t('app.skipToContent')}
          </a>

          <Sidebar
            steps={STEPS}
            currentStep={step}
            onSelect={setStep}
            onOpenSettings={() => setShowSettings(true)}
            onGoHome={() => setScreen('home')}
          />

          <div className="flex flex-col flex-1 overflow-hidden">
            <TopBar
              currentStep={step}
              onOpenTutorial={() => setShowTutorial(true)}
              onOpenExampleDatasets={() => setShowExampleDatasets(true)}
            />

            <main
              id="main-content"
              className="flex-1 overflow-auto p-6"
              aria-label={t('app.mainContent')}
              tabIndex={-1}
            >
              {step === 'load' && (
                <LoadPage onNext={() => setStep('configure')} />
              )}
              {step === 'configure' && (
                <ConfigurePage
                  onBack={() => setStep('load')}
                  onNext={() => setStep('results')}
                />
              )}
              {step === 'results' && (
                <ResultsPage
                  onBack={() => setStep('configure')}
                  onRestart={() => setStep('load')}
                />
              )}
            </main>
          </div>
        </div>
      )}

      {/* Los modales son compartidos entre las dos pantallas */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
      <TutorialModal
        open={showTutorial}
        onClose={() => setShowTutorial(false)}
        onOpenExampleDatasets={() => setShowExampleDatasets(true)}
      />
      <ExampleDatasetsModal
        open={showExampleDatasets}
        onClose={() => setShowExampleDatasets(false)}
        onOpenTutorial={() => setShowTutorial(true)}
      />
    </>
  );
}

export default function App() {
  return (
    <ProjectProvider>
      <AppShell />
    </ProjectProvider>
  );
}