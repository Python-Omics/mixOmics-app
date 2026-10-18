import { useState } from 'react';
import { ProjectProvider } from './lib/project-state';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LogPanel } from './components/LogPanel';
import { LoadPage } from './pages/LoadPage';
import { ConfigurePage } from './pages/ConfigurePage';
import { ResultsPage } from './pages/ResultsPage';
import { SettingsModal } from './components/SettingsModal';
import { TutorialModal } from './components/TutorialModal';
import { ExampleDatasetsModal } from './components/ExampleDatasetsModal';
import type { Step } from './lib/types';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'load', label: 'Cargar datos' },
  { id: 'configure', label: 'Configurar modelo' },
  { id: 'results', label: 'Resultados' },
];

function AppShell() {
  const [step, setStep] = useState<Step>('load');
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showExampleDatasets, setShowExampleDatasets] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-pharma-50">
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <Sidebar
        steps={STEPS}
        currentStep={step}
        onSelect={setStep}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          currentStep={step}
          onToggleLogs={() => setShowLogs((s) => !s)}
          showLogs={showLogs}
          onOpenTutorial={() => setShowTutorial(true)}
          onOpenExampleDatasets={() => setShowExampleDatasets(true)}
        />

        <main
          id="main-content"
          className="flex-1 overflow-auto p-6"
          aria-label="Contenido principal"
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

        {showLogs && <LogPanel onClose={() => setShowLogs(false)} />}
      </div>

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
    </div>
  );
}

export default function App() {
  return (
    <ProjectProvider>
      <AppShell />
    </ProjectProvider>
  );
}