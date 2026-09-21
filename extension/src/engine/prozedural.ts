/**
 * Textregeln - `beispiel.de#?#.box:has-text(Werbung)`.
 *
 * Der eine prozedurale Operator, der sich lohnt. GEMESSEN über alle
 * Quelllisten am 08.09.2026:
 *
 *   1.520  Zeilen mit `:has-text(` oder `:-abp-contains(` (dieselbe Sache
 *            unter zwei Namen)
 *     910  davon in der Form `<css>:has-text(text)` - Operator am ENDE
 *     197  mit einem regulären Ausdruck als Argument
 *       0  mit `:upward(` oder `:nth-ancestor(` dahinter
 *
 * Die 0 ist der Grund, warum hier kein `:upward` steht: Der Plan hatte es
 * vorgesehen, in den echten Listen kommt es hinter einer Textsuche kein
 * einziges Mal vor.
 *
 * Warum nur die Form mit dem Operator am ENDE: Die übrigen 610 stehen
 * verschachtelt (`.a:has(h2:has-text(Anzeigen))`) oder tragen Kombinatoren
 * dahinter (`:has-text(Werbung) + .box`). Beides richtig aufzulösen heißt,
 * einen Selektor-Parser samt Auswertung zu bauen. Solange der nicht steht,
 * wäre jede Abkürzung ein Element, das VIELLEICHT gemeint war - und ein
 * falsch verstecktes Element ist eine kaputte Seite. Sie fallen weiter unter
 * `erweiterteKosmetik` heraus, gezählt und sichtbar.
 *
 * Was der Läufer im Inhaltsskript daraus macht: `wahl` in `querySelectorAll`,
 * dann `innerText` gegen `text` halten, und was trifft, verstecken. Deshalb
 * muss `wahl` ein Selektor sein, den der Browser SELBST versteht - geprüft
 * mit derselben Grammatik wie jede andere Kosmetikregel.
 */
import type { Regel } from './abp.ts';
import { hostGueltig, selektorGueltig } from './kosmetik.ts';

/** Eine Textregel: Selektor plus das, was drinstehen muss. */
export type Textregel = {
  /** Selektor, den der Browser selbst versteht. */
  wahl: string;
  /** Gesuchter Text. `/muster/` heißt regulärer Ausdruck, sonst Teilstring. */
  text: string;
};

/** Textregeln je Host, so wie sie ins Paket gehen. */
export type ProzeduralKarte = Record<string, Textregel[]>;

const OPERATOREN = [':has-text(', ':-abp-contains(', ':contains('];

/**
 * Zerlegt `<css>:has-text(<text>)` - und nur das.
 *
 * Streng in beide Richtungen: Der Operator muss der LETZTE sein, seine
 * Klammer muss am Ende zugehen, und was davor steht, muss ein gültiger
 * Selektor sein. Alles andere gibt `null`, und der Aufrufer zählt es als
 * nicht umgesetzt.
 */
export function alsTextregel(selektor: string): Textregel | null {
  for (const op of OPERATOREN) {
    const start = selektor.lastIndexOf(op);
    if (start <= 0) continue;

    // Von der öffnenden Klammer bis zur passenden schließenden zählen -
    // `:has-text(a (b) c)` ist eine gültige Zeile.
    let tiefe = 0;
    let ende = -1;
    for (let i = start + op.length - 1; i < selektor.length; i += 1) {
      const z = selektor[i];
      if (z === '\\') {
        i += 1;
        continue;
      }
      if (z === '(') tiefe += 1;
      else if (z === ')') {
        tiefe -= 1;
        if (tiefe === 0) {
          ende = i;
          break;
        }
      }
    }
    // Die Klammer muss das letzte Zeichen sein: sonst folgt ein Kombinator
    // oder ein weiterer Operator, und beides können wir nicht.
    if (ende !== selektor.length - 1) continue;

    const wahl = selektor.slice(0, start).trim();
    const text = selektor.slice(start + op.length, ende).trim();
    if (wahl === '' || text === '') return null;
    // Der Rest darf keinen zweiten Textoperator mehr tragen.
    if (OPERATOREN.some((o) => wahl.includes(o))) return null;
    if (!selektorGueltig(wahl)) return null;
    return { wahl, text };
  }
  return null;
}

/**
 * Textregeln je Host aus den gelesenen Regeln.
 *
 * Nur `#?#`-Regeln (`prozedural`), nur solche, die als reines CSS NICHT schon
 * durchgehen - die sind in `zuKosmetik` besser aufgehoben, weil der Browser
 * sie ohne jeden Läufer anwendet.
 */
export function zuTextregeln(regeln: Regel[]): ProzeduralKarte {
  const jeHost = new Map<string, Map<string, Textregel>>();
  const zurueck = new Map<string, Set<string>>();

  for (const regel of regeln) {
    if (regel.typ !== 'kosmetik' || !regel.prozedural) continue;
    if (selektorGueltig(regel.selektor)) continue;
    const t = alsTextregel(regel.selektor);
    if (t === null) continue;
    const hosts = regel.domains.filter(hostGueltig);
    // Eine Textregel ohne Host liefe auf jeder Seite der Welt und müsste bei
    // jeder DOM-Änderung neu bewertet werden. In den Quelllisten gibt es
    // keine solche Zeile; käme eine, bliebe sie draussen.
    if (hosts.length === 0) continue;
    if (!regel.ausgeschlosseneDomains.every(hostGueltig)) continue;

    const schluessel = `${t.wahl} ${t.text}`;
    for (const host of hosts) {
      if (regel.ausnahme) {
        let menge = zurueck.get(host);
        if (!menge) {
          menge = new Set();
          zurueck.set(host, menge);
        }
        menge.add(schluessel);
        continue;
      }
      let karte = jeHost.get(host);
      if (!karte) {
        karte = new Map();
        jeHost.set(host, karte);
      }
      karte.set(schluessel, t);
    }
  }

  const aus: ProzeduralKarte = {};
  for (const host of [...jeHost.keys()].sort()) {
    const karte = jeHost.get(host)!;
    for (const schluessel of zurueck.get(host) ?? []) karte.delete(schluessel);
    if (karte.size > 0) aus[host] = [...karte.values()];
  }
  return aus;
}
