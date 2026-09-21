/**
 * Werkzeug der Engine-Tests: ein kleiner Abgleich, der die DNR-Grammatik
 * nachbildet, damit ein Test fragen kann „würde diese URL von dieser Regel
 * getroffen?" ohne einen Browser.
 *
 * Bewusst nur das, was `dnr.ts` erzeugt: `urlFilter` (`||`, `|`, `^`, `*`),
 * `regexFilter`, `requestDomains`, `initiatorDomains` (+ excluded),
 * `resourceTypes` (+ excluded), `domainType`. Kein Anspruch, Chrome bis ins
 * Letzte nachzustellen; die Grenzfälle, die hier zählen, sind Anker und
 * Trennzeichen.
 */
import type { DnrRegel, DnrRessource } from '../../src/engine/dnr-typen.ts';

export type Anfrage = {
  url: string;
  /** Herkunft (Seite, die die Anfrage stellt); fehlt bei Navigationen. */
  initiator?: string;
  typ: DnrRessource;
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Gebaute Ausdruecke, gemerkt.
 *
 * Ein Aufrufer, der eine Anfrage gegen einen ganzen Regelsatz haelt, kommt
 * hier zehntausende Male vorbei — und ohne Merker uebersetzt jede dieser
 * Runden dieselben Filter erneut. GEMESSEN in `tests/rechenregeln/83`: acht
 * Anfragen gegen die aktiven Listen brauchten elf Sekunden, mit Merker
 * bleiben davon gut zwei.
 */
const gemerkteAusdruecke = new Map<string, RegExp>();

/** `urlFilter` als regulärer Ausdruck, Grammatik wie in der Chrome-Doku. */
export function urlFilterZuRegex(filter: string): RegExp {
  const fertig = gemerkteAusdruecke.get(filter);
  if (fertig) return fertig;
  const neu = baueAusdruck(filter);
  gemerkteAusdruecke.set(filter, neu);
  return neu;
}

function baueAusdruck(filter: string): RegExp {
  let rest = filter;
  let anfang = '';
  let ende = '';
  if (rest.startsWith('||')) {
    // Hostanker: Beginn eines Hostnamens oder einer Subdomain.
    anfang = '^[a-z][a-z0-9+.-]*://([^/?#]*\\.)?';
    rest = rest.slice(2);
  } else if (rest.startsWith('|')) {
    anfang = '^';
    rest = rest.slice(1);
  }
  if (rest.endsWith('|')) {
    ende = '$';
    rest = rest.slice(0, -1);
  }
  let rumpf = '';
  for (const zeichen of rest) {
    if (zeichen === '*') rumpf += '.*';
    else if (zeichen === '^') rumpf += '(?:[^a-zA-Z0-9_\\-.%]|$)';
    else rumpf += escapeRegex(zeichen);
  }
  return new RegExp(anfang + rumpf + ende, 'i');
}

function hostVon(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

function domainPasst(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Grob: gleiche letzten zwei Labels = gleiche Partei. Für Tests reicht das. */
function gleichePartei(a: string, b: string): boolean {
  const basis = (h: string) => h.split('.').slice(-2).join('.');
  return basis(a) === basis(b);
}

export function passtRegel(regel: DnrRegel, anfrage: Anfrage): boolean {
  const b = regel.condition;
  const host = hostVon(anfrage.url);
  const initiatorHost = anfrage.initiator ? hostVon(anfrage.initiator) : null;

  if (b.urlFilter !== undefined && !urlFilterZuRegex(b.urlFilter).test(anfrage.url)) return false;
  if (b.regexFilter !== undefined && !new RegExp(b.regexFilter, 'i').test(anfrage.url)) return false;
  if (b.requestDomains && !b.requestDomains.some((d) => domainPasst(host, d))) return false;
  if (b.excludedRequestDomains?.some((d) => domainPasst(host, d))) return false;
  if (b.initiatorDomains) {
    if (initiatorHost === null) return false;
    if (!b.initiatorDomains.some((d) => domainPasst(initiatorHost, d))) return false;
  }
  if (b.excludedInitiatorDomains && initiatorHost !== null) {
    if (b.excludedInitiatorDomains.some((d) => domainPasst(initiatorHost, d))) return false;
  }
  if (b.resourceTypes && !b.resourceTypes.includes(anfrage.typ)) return false;
  if (b.excludedResourceTypes?.includes(anfrage.typ)) return false;
  if (b.domainType) {
    const dritt = initiatorHost === null ? false : !gleichePartei(host, initiatorHost);
    if (b.domainType === 'thirdParty' && !dritt) return false;
    if (b.domainType === 'firstParty' && dritt) return false;
  }
  return true;
}

/**
 * Was Chrome am Ende täte: höchste Priorität gewinnt, bei Gleichstand
 * schlägt allow/allowAllRequests block. Null, wenn keine Regel passt.
 */
export function entscheidung(rules: DnrRegel[], anfrage: Anfrage): { regel: DnrRegel; aktion: string } | null {
  let beste: DnrRegel | null = null;
  const rang = (r: DnrRegel) => r.priority * 10 + (r.action.type === 'block' ? 0 : 1);
  for (const regel of rules) {
    if (!passtRegel(regel, anfrage)) continue;
    if (beste === null || rang(regel) > rang(beste)) beste = regel;
  }
  return beste ? { regel: beste, aktion: beste.action.type } : null;
}
