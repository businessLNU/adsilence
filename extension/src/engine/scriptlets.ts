/**
 * Scriptlet-Regeln (`host##+js(name, args)`) → Einträge je Host.
 *
 * Nur die Scriptlets, die `src/scriptlets/bibliothek.ts` (B1) wirklich
 * enthält - die Namensliste kommt von dort, damit sie nicht zweimal gepflegt
 * werden muss. Ein Name, den die Bibliothek nicht kennt, würde im Seitenkontext
 * still nichts tun; hier fällt er sichtbar weg (`scriptletUnbekannt`).
 *
 * uBO-Kürzel (`aopr`, `set`, `nostif`, ...) werden auf den langen Namen
 * abgebildet, damit die Bibliothek nur eine Schreibweise kennen muss.
 */
import type { Regel } from './abp.ts';
import { zaehle } from './gruende.ts';
import { hostGueltig } from './kosmetik.ts';
import { BEKANNTE_SCRIPTLETS } from '../scriptlets/bibliothek.ts';

/**
 * EINE Quelle, nicht zwei: Die Namen stehen dort, wo die Scriptlets gebaut
 * werden. Standen sie hier noch einmal, waere ein Name denkbar, den der
 * Konverter durchlaesst und die Bibliothek nicht kennt - die Regel landete im
 * Paket und taete in der Seite nichts. Genau das faellt niemandem auf.
 */
export const BEKANNT = BEKANNTE_SCRIPTLETS;

export type ScriptletName = (typeof BEKANNT)[number];

export type Scriptlet = { name: ScriptletName; args: string[] };

const KUERZEL: Record<string, ScriptletName> = {
  aopr: 'abort-on-property-read',
  aopw: 'abort-on-property-write',
  acs: 'abort-current-script',
  acis: 'abort-current-script',
  'abort-current-inline-script': 'abort-current-script',
  set: 'set-constant',
  nostif: 'no-setTimeout-if',
  'setTimeout-defuser': 'no-setTimeout-if',
  nosiif: 'no-setInterval-if',
  'setInterval-defuser': 'no-setInterval-if',
  aeld: 'prevent-addEventListener',
  'addEventListener-defuser': 'prevent-addEventListener',
  'silent-noeval': 'noeval',
  'noeval-if': 'noeval',
  aost: 'abort-on-stack-trace',
  'prevent-xhr': 'no-xhr-if',
  'prevent-fetch': 'no-fetch-if',
  rc: 'remove-class',
  'bab-defuser': 'nobab',
};

/** Langer Name für Name oder Kürzel, sonst null. `.js` am Ende ist egal. */
export function scriptletName(name: string): ScriptletName | null {
  const kern = name.trim().replace(/\.js$/, '');
  if ((BEKANNT as readonly string[]).includes(kern)) return kern as ScriptletName;
  return KUERZEL[kern] ?? null;
}

type Eintrag = Scriptlet & { schluessel: string };

function schluesselVon(s: Scriptlet): string {
  return JSON.stringify([s.name, s.args]);
}

/**
 * Scriptlets je Host. Ausnahmen (`host#@#+js(...)`) nehmen passende Einträge
 * zurück; `host#@#+js()` ohne Argumente nimmt alle für den Host zurück.
 * Reihenfolge je Host: wie in der Liste, ohne Doppelte.
 */
export function zuScriptlets(regeln: Regel[], verworfen: Record<string, number> = {}): Record<string, Scriptlet[]> {
  const jeHost = new Map<string, Eintrag[]>();
  const alleZurueck = new Set<string>();
  const einzelneZurueck = new Map<string, Set<string>>();

  for (const regel of regeln) {
    if (regel.typ !== 'scriptlet') continue;

    if (regel.ausnahme && regel.name === '') {
      for (const host of regel.domains.filter(hostGueltig)) alleZurueck.add(host);
      continue;
    }

    const name = scriptletName(regel.name);
    if (name === null) {
      zaehle(verworfen, { grund: 'scriptletUnbekannt' });
      continue;
    }
    const hosts = regel.domains.filter(hostGueltig);
    if (hosts.length === 0) {
      zaehle(verworfen, { grund: regel.domains.length === 0 ? 'scriptletOhneDomain' : 'domainUngueltig' });
      continue;
    }
    const scriptlet: Scriptlet = { name, args: regel.args };
    const schluessel = schluesselVon(scriptlet);

    if (regel.ausnahme) {
      for (const host of hosts) {
        let menge = einzelneZurueck.get(host);
        if (!menge) {
          menge = new Set();
          einzelneZurueck.set(host, menge);
        }
        menge.add(schluessel);
      }
      continue;
    }

    for (const host of hosts) {
      const liste = jeHost.get(host) ?? [];
      if (!liste.some((e) => e.schluessel === schluessel)) liste.push({ ...scriptlet, schluessel });
      jeHost.set(host, liste);
    }
  }

  const ergebnis: Record<string, Scriptlet[]> = {};
  for (const host of Array.from(jeHost.keys()).sort()) {
    if (alleZurueck.has(host)) continue;
    const zurueck = einzelneZurueck.get(host);
    const liste = jeHost
      .get(host)!
      .filter((e) => !zurueck?.has(e.schluessel))
      .map(({ name, args }) => ({ name, args }));
    if (liste.length > 0) ergebnis[host] = liste;
  }
  return ergebnis;
}
