import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Inter (variable font) se incluye en el bundle, no requiere CDN ni red.
// Cubre pesos 100-900 + italic en un solo archivo.
import '@fontsource-variable/inter';
import App from './App';
import './styles/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No se encontró #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);