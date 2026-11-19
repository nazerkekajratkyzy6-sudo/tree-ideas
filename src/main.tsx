import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/cyrillic-700.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/playfair-display/cyrillic-500.css';
import '@fontsource/playfair-display/latin-500.css';
import './styles.css';

const Display = lazy(() => import('./pages/Display'));
const Join = lazy(() => import('./pages/Join'));

const path = location.pathname.replace(/\/+$/, '') || '/';
const Page = path.startsWith('/ekran-') ? Display : Join;

createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={null}><Page /></Suspense></StrictMode>,
);
