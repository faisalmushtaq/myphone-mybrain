import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SiteShell } from './SiteShell';
import './styles/app.css';

const mount = document.getElementById('mpmb-consent-app');

if (mount) {
  mount.classList.add('mpmb-app');
  createRoot(mount).render(<StrictMode>{__STANDALONE__ ? <SiteShell><App /></SiteShell> : <App />}</StrictMode>);
}
