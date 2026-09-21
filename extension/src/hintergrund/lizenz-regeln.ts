/**
 * Was aus dem gespeicherten Lizenzstand WIRKSAM wird. Reine Funktionen.
 */

import { GNADENFRIST_MS, LIZENZ_FRISCH_MS } from '../gemeinsam/konstanten.ts';
import type { Lizenz } from '../gemeinsam/typen.ts';

export function freiLizenz(jetzt: number): Lizenz {
  return {
    tarif: 'frei',
    premium: false,
    planKeys: [],
    gueltigBis: null,
    endetZumTermin: false,
    hinweis: null,
    geprueftAm: jetzt,
  };
}

/**
 * Der Stand, mit dem gearbeitet wird.
 *
 * Premium gilt, solange die letzte Bestaetigung des Servers hoechstens sieben
 * Tage her ist. Wer laenger offline ist, faellt auf frei, bis der Server
 * wieder antwortet. Ein `gueltigBis` in der Vergangenheit zaehlt ebenfalls
 * nur bis zum Ende der Gnadenfrist: Der Server haette die Verlaengerung
 * laengst gemeldet, wenn es sie gaebe.
 */
export function lizenzWirksam(gespeichert: Lizenz | null, jetzt: number): Lizenz {
  if (!gespeichert) return freiLizenz(jetzt);
  if (!gespeichert.premium) return gespeichert;

  const bestaetigungAlt = jetzt - gespeichert.geprueftAm > GNADENFRIST_MS;
  const ablauf = gespeichert.gueltigBis ? Date.parse(gespeichert.gueltigBis) : NaN;
  const abgelaufen = Number.isFinite(ablauf) && jetzt - ablauf > GNADENFRIST_MS;

  if (bestaetigungAlt || abgelaufen) {
    return { ...gespeichert, tarif: 'frei', premium: false };
  }
  return gespeichert;
}

/** Juenger als eine Stunde: das Popup muss nicht nachfragen. */
export function lizenzFrisch(gespeichert: Lizenz | null, jetzt: number): boolean {
  return gespeichert !== null && jetzt - gespeichert.geprueftAm < LIZENZ_FRISCH_MS;
}
