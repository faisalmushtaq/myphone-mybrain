import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabApp } from './lab/LabApp';
import type { LabFlow } from './lab/model';
import './styles/app.css';

const mount = document.getElementById('mpmb-lab-app');

/** Which of the study's pages this is: the Jekyll page says so with data-flow; the plain test page takes ?flow=. */
function flowOf(el: HTMLElement): LabFlow {
  const wanted = el.dataset.flow ?? new URLSearchParams(window.location.search).get('flow');
  return wanted === 'checkin' || wanted === 'after' ? wanted : 'baseline';
}

if (mount) {
  mount.classList.add('mpmb-app');
  createRoot(mount).render(
    <StrictMode>
      <LabApp flow={flowOf(mount)} />
    </StrictMode>,
  );
}
