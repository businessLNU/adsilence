/**
 * Erscheinungsbild am `<html>`: `data-thema="hell|dunkel"` erzwingt ein
 * Schema, `system` entfernt das Attribut und laesst `prefers-color-scheme`
 * entscheiden (siehe `tokens.css`).
 */
import type { Thema } from '../gemeinsam/typen.ts';

export function wendeThemaAn(thema: Thema | undefined): void {
  if (typeof document === 'undefined') return;
  const wurzel = document.documentElement;
  if (thema === 'hell' || thema === 'dunkel') wurzel.dataset.thema = thema;
  else delete wurzel.dataset.thema;
}
