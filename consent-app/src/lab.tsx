import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabApp } from './lab/LabApp';
import './styles/app.css';

const mount = document.getElementById('mpmb-lab-app');

if (mount) {
  mount.classList.add('mpmb-app');
  createRoot(mount).render(
    <StrictMode>
      <LabApp />
    </StrictMode>,
  );
}
