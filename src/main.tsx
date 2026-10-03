import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppRouter from './app/router/Router';
import { lab } from './application/LabController';
import './styles.css';
import './features.css';

void lab.initialize().then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><AppRouter/></StrictMode>);
  // Best effort flush. IndexedDB cannot guarantee completion after the page closes.
  // Registered only after loading: an earlier save would overwrite the stored playground with the default one.
  document.addEventListener('visibilitychange', () => { if (document.hidden) void lab.save(); });
});
