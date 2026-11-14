import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Inter (variable font) se incluye en el bundle, no requiere CDN ni red.
// Cubre pesos 100-900 + italic en un solo archivo.
import '@fontsource-variable/inter';
import App from './App';
import { I18nProvider } from './i18n';
import './styles/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No se encontró #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

// Ocultar el splash screen después del primer paint de React.
// requestAnimationFrame garantiza que la UI ya se pintó al menos una vez.
requestAnimationFrame(() => {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    // Remover del DOM después de la transición para liberar el listener
    setTimeout(() => splash.remove(), 300);
  }
});