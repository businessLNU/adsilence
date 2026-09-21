/**
 * `$popup`-Regeln → eine Liste von Hosts, die als TAB nicht aufgehen sollen.
 *
 * Warum das nicht über DNR geht: Ein Popunder ist kein Netzabruf, den man
 * ablehnen könnte, sondern ein neuer Tab. `declarativeNetRequest` kann eine
 * Navigation im Hauptrahmen nicht blocken, ohne die Seite zu sperren — deshalb
 * verwirft `dnr.ts` diese Regeln (`grund: 'popup'`). Was der Hintergrund
 * dagegen kann: einen frisch geöffneten Tab wieder schliessen, wenn seine
 * Adresse auf einen dieser Hosts zeigt UND ihn eine Seite geöffnet hat.
 *
 * GEMESSEN über alle Quelllisten am 08.09.2026: 6.613 `$popup`-Zeilen, davon
 * 4.558 reine Host-Anker (`||adfoc.us^$popup`) und 116 Ausnahmen. Die
 * übrigen sind Pfadmuster (`/adsph2/*$popup`); die brauchten einen
 * URL-Vergleicher im Hintergrund und bleiben vorerst draussen — sichtbar
 * gezählt, nicht stillschweigend.
 *
 * Absichtlich NICHT übernommen:
 *   • `domain=` (gemessen 9 Zeilen) — die Bedingung gälte für die öffnende
 *     Seite, und der Tab kennt sie nur über `openerTabId`.
 *   • `~third-party` (8 Zeilen).
 * Beides fiele unter „fast richtig", und fast richtig heisst hier: einen Tab
 * schliessen, den der Nutzer wollte.
 */
import type { Regel } from './abp.ts';
import { zaehle } from './gruende.ts';
import { hostGueltig } from './kosmetik.ts';

/** Was aus einer Liste an Popup-Wissen übrig bleibt. */
export type PopupListe = {
  /** Hosts, deren Tab geschlossen wird. Kleinbuchstaben, ohne Doppelte. */
  hosts: string[];
  /** `@@||host^$popup`: Hosts, die ausdrücklich aufgehen dürfen. */
  ausnahmen: string[];
};

/**
 * Der Host eines reinen Ankers `||beispiel.de^`, sonst null.
 *
 * Streng: Ein Platzhalter (`||ad*.com^`) oder ein Pfad hinter dem Host
 * (`||a.de/werbung`) gibt null. Ein Host, der ein bisschen passt, schliesst
 * irgendwann den falschen Tab.
 */
export function popupHostVon(muster: string): string | null {
  const treffer = /^\|\|([^/^*|]+)\^?$/.exec(muster);
  if (!treffer) return null;
  const host = treffer[1]!.toLowerCase();
  return hostGueltig(host) ? host : null;
}

/** Trägt die Regel `$popup` (und ist sie keine Ausnahme)? */
function istPopup(regel: Regel): boolean {
  return regel.typ === 'netz' && regel.typen.includes('popup');
}

/**
 * Kann diese Regel als Tab-Schliesser laufen? `dnr.ts` fragt das, um sie
 * getrennt zu zählen: „nicht als DNR-Regel umsetzbar" und „dafür als
 * Tab-Schliesser übernommen" sind zwei verschiedene Aussagen, und nur die
 * zweite darf im Bericht wie ein Erfolg aussehen.
 */
export function alsTabSchliesser(regel: Regel): boolean {
  if (!istPopup(regel) || regel.typ !== 'netz') return false;
  if (regel.domains.length > 0 || regel.ausgeschlosseneDomains.length > 0) return false;
  if (regel.drittanbieter === false) return false;
  return popupHostVon(regel.muster) !== null;
}

/** Alle `$popup`-Hosts einer gelesenen Liste, Ausnahmen getrennt. */
export function zuPopupHosts(regeln: Regel[], verworfen: Record<string, number> = {}): PopupListe {
  const hosts = new Set<string>();
  const ausnahmen = new Set<string>();

  for (const regel of regeln) {
    if (regel.typ !== 'netz' || !istPopup(regel)) continue;
    const host = popupHostVon(regel.muster);
    if (host === null) continue;
    if (regel.ausnahme) {
      ausnahmen.add(host);
      continue;
    }
    if (!alsTabSchliesser(regel)) {
      // Eine Bedingung, die der Tab nicht kennt. Sichtbar zählen.
      zaehle(verworfen, { grund: 'optionNichtUmsetzbar', option: 'popup-bedingung' });
      continue;
    }
    hosts.add(host);
  }

  // Eine Ausnahme schlägt die Blockregel — wie überall sonst auch.
  for (const host of ausnahmen) hosts.delete(host);

  return { hosts: [...hosts].sort(), ausnahmen: [...ausnahmen].sort() };
}
