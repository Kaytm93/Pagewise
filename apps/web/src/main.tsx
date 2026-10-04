import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/instrument-sans/latin-500.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiClient } from './api/client';
import { registerServiceWorker } from './pwa/register';
import { applyDesign, readDesign } from './ui/design';
import { initFx } from './ui/fx';
import { applyTheme, readTheme } from './ui/theme';

applyTheme(readTheme());
applyDesign(readDesign());
initFx();

const container = document.getElementById('root');
if (!container) throw new Error('Wurzelelement #root fehlt');

createRoot(container).render(
  <StrictMode>
    <App client={new ApiClient()} />
  </StrictMode>,
);

// Erst nach dem Laden anmelden, damit der Service Worker den Start nicht bremst.
window.addEventListener('load', () => void registerServiceWorker());
