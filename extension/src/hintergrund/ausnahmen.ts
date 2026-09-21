/**
 * Reine Rechenregeln rund um Hosts und Ausnahmen. Keine Browser-API, damit
 * `tests/hintergrund/ausnahmen.test.ts` sie ohne Erweiterung fahren kann.
 */

import { ID_AUSNAHME_BIS, ID_AUSNAHME_VON, PRIORITAET_AUSNAHME } from '../gemeinsam/konstanten.ts';
import type { Sites } from '../gemeinsam/typen.ts';

/**
 * Host aus einer Adresse, klein geschrieben, ohne Port. Nur http(s) zaehlt:
 * `chrome://`, `about:` und Dateien bekommen keine Kosmetik und keine
 * Scriptlets, und eine Ausnahme fuer sie haette keinen Sinn.
 */
export function hostAus(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Der Host und alle uebergeordneten Domains, spezifischste zuerst:
 * `a.b.example.com` → `[a.b.example.com, b.example.com, example.com]`.
 * Die TLD allein (`com`) faellt weg; niemand traegt sie als Ausnahme ein.
 */
export function hostKette(host: string): string[] {
  const teile = host.split('.').filter(Boolean);
  const kette: string[] = [];
  for (let i = 0; i < teile.length - 1; i++) kette.push(teile.slice(i).join('.'));
  if (kette.length === 0 && host) kette.push(host);
  return kette;
}

/** Ist der Host (oder eine Domain darueber) als Ausnahme eingetragen? */
export function siteErlaubt(sites: Sites, host: string): boolean {
  return hostKette(host).some((h) => sites[h]?.erlaubt === true);
}

/**
 * Die dynamische Regel, die einen Host ganz freistellt: `allowAllRequests`
 * auf Haupt- und Unterrahmen laesst jede Anfrage dieser Seite durch, auch
 * die an Drittanbieter. `requestDomains` trifft auch Subdomains.
 */
export function ausnahmeRegel(host: string, id: number): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: PRIORITAET_AUSNAHME,
    action: { type: 'allowAllRequests' as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      requestDomains: [host],
      resourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
    },
  };
}

/**
 * Alle Ausnahmeregeln aus dem Speicher, IDs 1 bis 1000 in fester Reihenfolge
 * (Hosts sortiert), damit zwei Laeufe dieselben Regeln ergeben. Mehr als
 * 1000 erlaubte Hosts fallen weg; die Grenze steht in `konstanten.ts` und
 * kommt von Firefox (5000 dynamische Regeln insgesamt).
 */
export function baueAusnahmen(sites: Sites): chrome.declarativeNetRequest.Rule[] {
  const hosts = Object.keys(sites)
    .filter((h) => sites[h]?.erlaubt === true)
    .sort();
  const regeln: chrome.declarativeNetRequest.Rule[] = [];
  for (const host of hosts) {
    const id = ID_AUSNAHME_VON + regeln.length;
    if (id > ID_AUSNAHME_BIS) break;
    regeln.push(ausnahmeRegel(host, id));
  }
  return regeln;
}

/** Muster fuer `excludeMatches` eines registrierten Inhaltsskripts. */
export function ausschlussMuster(sites: Sites): string[] {
  const muster: string[] = [];
  for (const host of Object.keys(sites).sort()) {
    if (sites[host]?.erlaubt !== true) continue;
    muster.push(`*://${host}/*`, `*://*.${host}/*`);
  }
  return muster;
}
