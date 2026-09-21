/**
 * Einstieg des Popups. Sprache und Thema kommen VOR dem ersten Zeichnen
 * (`starteOberflaeche`), damit nichts umspringt. Keine Einblendung: Das
 * Popup wird hundertmal am Tag geoeffnet.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../oberflaeche/basis.css';
import './popup.css';
import { starteOberflaeche } from '../oberflaeche/start.ts';
import { App } from './App.tsx';

void starteOberflaeche().finally(() => {
  createRoot(document.getElementById('wurzel')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
