import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabApp } from './lab/LabApp';
import type { LabPhase } from './api/types';
import type { LabFlow } from './lab/model';
import './styles/app.css';

const mount = document.getElementById('mpmb-lab-app');

/** Which of the study's pages this is: the Jekyll page says so with data-flow; the plain test page takes ?flow=. */
function flowOf(el: HTMLElement): LabFlow {
  const wanted = el.dataset.flow ?? new URLSearchParams(window.location.search).get('flow');
  return wanted === 'checkin' || wanted === 'after' || wanted === 'book' || wanted === 'story' ? wanted : 'baseline';
}

/** MyStory's own page serves every phase: the link says which (?phase=pre, mid or post). */
function phaseOf(flow: LabFlow): LabPhase | undefined {
  if (flow !== 'story') return undefined;
  const wanted = new URLSearchParams(window.location.search).get('phase');
  return wanted === 'pre' || wanted === 'post' ? wanted : 'mid';
}

if (mount) {
  mount.classList.add('mpmb-app');
  const flow = flowOf(mount);
  createRoot(mount).render(
    <StrictMode>
      <LabApp flow={flow} phase={phaseOf(flow)} />
    </StrictMode>,
  );
}
