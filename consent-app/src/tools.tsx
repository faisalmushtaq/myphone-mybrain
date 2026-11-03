import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from './portal/PortalApp';
import { SchoolDbs } from './tools/SchoolDbs';
import { SchoolUpload } from './tools/SchoolUpload';
import { StaffApp } from './tools/StaffApp';
import './styles/app.css';

/**
 * The tools: the research team's staff page (/staff/), the staff portal
 * (/portal/, docs/portal.md), each school's upload page for its UPN lists (/schools/upload/?school=<slug>)
 * and each school's password-protected DBS page (/schools/dbs/?school=<slug>).
 * The Jekyll page says which with data-tool; the plain test page takes ?tool=.
 */
const mount = document.getElementById('mpmb-tools');

if (mount) {
  const tool = mount.dataset.tool ?? new URLSearchParams(window.location.search).get('tool');
  mount.classList.add('mpmb-app');
  createRoot(mount).render(<StrictMode>{tool === 'school-upload' ? <SchoolUpload /> : tool === 'school-dbs' ? <SchoolDbs /> : tool === 'portal' ? <PortalApp /> : <StaffApp />}</StrictMode>);
}
