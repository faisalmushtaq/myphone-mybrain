import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NewYearApp } from './newyear/NewYearApp';
import './styles/app.css';
import './newyear/newyear.css';

/**
 * The New Year social media break: an unlisted preview at /new-year/
 * (newyear.html in development). Everything stays in this browser; the page
 * makes no network requests of its own.
 */
const mount = document.getElementById('mpmb-newyear-app');

if (mount) {
  mount.classList.add('mpmb-app');
  createRoot(mount).render(
    <StrictMode>
      <NewYearApp />
    </StrictMode>,
  );
}
