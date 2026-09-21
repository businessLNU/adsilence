/**
 * Eigene Regeln aus dem Textfeld der Optionsseite.
 *
 * Dieselben Funktionen wie der Listenbau, nur mit Zeilennummern: Der Nutzer
 * soll sehen, WELCHE Zeile nicht geht und WARUM, statt dass sie still
 * verschwindet. `regeln` enthält nur, was auch umsetzbar ist; der Hintergrund
 * gibt es unverändert an `zuDnr`, `zuKosmetik` und `zuScriptlets` weiter.
 */
import { parseZeile } from './abp.ts';
import type { Regel } from './abp.ts';
import { pruefeNetzregel } from './dnr.ts';
import type { Grund } from './gruende.ts';
import { grundFuerSelektor, hostGueltig, selektorGueltig } from './kosmetik.ts';
import { scriptletName } from './scriptlets.ts';

export type Regelfehler = {
  /** 1-basiert, wie im Textfeld gezählt. */
  zeile: number;
  grund: Grund;
  /** Bei `optionNichtUmsetzbar`: die Option. */
  option?: string;
  /** Die Zeile selbst, für die Anzeige neben der Meldung. */
  text: string;
};

export type EigeneRegeln = {
  regeln: Regel[];
  fehler: Regelfehler[];
};

export function eigeneRegeln(text: string): EigeneRegeln {
  const regeln: Regel[] = [];
  const fehler: Regelfehler[] = [];
  const zeilen = text.split('\n');

  for (let i = 0; i < zeilen.length; i += 1) {
    const zeile = zeilen[i];
    const nummer = i + 1;
    const regel = parseZeile(zeile);
    if (regel === null) continue;

    if (regel.typ === 'unbekannt') {
      fehler.push({ zeile: nummer, grund: regel.grund, text: zeile });
      continue;
    }

    if (regel.typ === 'netz') {
      const verwerfung = pruefeNetzregel(regel);
      if (verwerfung) {
        fehler.push({ zeile: nummer, grund: verwerfung.grund, option: verwerfung.option, text: zeile });
        continue;
      }
    } else if (regel.typ === 'kosmetik') {
      if (!selektorGueltig(regel.selektor)) {
        fehler.push({ zeile: nummer, grund: grundFuerSelektor(regel), text: zeile });
        continue;
      }
      if (![...regel.domains, ...regel.ausgeschlosseneDomains].every(hostGueltig)) {
        fehler.push({ zeile: nummer, grund: 'domainUngueltig', text: zeile });
        continue;
      }
    } else if (regel.typ === 'scriptlet') {
      if (!regel.ausnahme && scriptletName(regel.name) === null) {
        fehler.push({ zeile: nummer, grund: 'scriptletUnbekannt', text: zeile });
        continue;
      }
      if (regel.domains.length === 0) {
        fehler.push({ zeile: nummer, grund: 'scriptletOhneDomain', text: zeile });
        continue;
      }
      if (![...regel.domains, ...regel.ausgeschlosseneDomains].every(hostGueltig)) {
        fehler.push({ zeile: nummer, grund: 'domainUngueltig', text: zeile });
        continue;
      }
    }

    regeln.push(regel);
  }

  return { regeln, fehler };
}
