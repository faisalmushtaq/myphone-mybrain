import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolUpload } from './tools/SchoolUpload';
import { StaffApp } from './tools/StaffApp';
import './styles/app.css';

/**
 * The tools: the research team's staff page (/break/staff/) and each
 * school's upload page for its UPN lists (/schools/upload/?school=<slug>).
 * The Jekyll page says which with data-tool; the plain test page takes ?tool=.
 */
const mount = document.getElementById('mpmb-tools');

if (mount) {
  const tool = mount.dataset.tool ?? new URLSearchParams(window.location.search).get('tool');
  mount.classList.add('mpmb-app');
  createRoot(mount).render(<StrictMode>{tool === 'school-upload' ? <SchoolUpload /> : <StaffApp />}</StrictMode>);
}
