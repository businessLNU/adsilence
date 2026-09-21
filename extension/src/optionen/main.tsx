/**
 * Einstieg der Optionsseite. Wie beim Popup: erst Sprache und Thema, dann
 * zeichnen.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../oberflaeche/basis.css';
import './optionen.css';
import { starteOberflaeche } from '../oberflaeche/start.ts';
import { App } from './App.tsx';

void starteOberflaeche().finally(() => {
  createRoot(document.getElementById('wurzel')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
