/**
 * Schlanke Typen für declarativeNetRequest-Regeln.
 *
 * Absichtlich KEIN `chrome.declarativeNetRequest.Rule` aus `@types/chrome`:
 * Der Konverter läuft im Build (Node, ohne Browser-Typen) und im Service
 * Worker (mit ihnen). Zwei Umgebungen, eine Typdefinition, keine Abhängigkeit.
 * Die Feldnamen sind exakt die aus dem Chrome-Schema, damit ein Objekt dieses
 * Typs unverändert an `updateDynamicRules` gehen oder in `rules/<id>.json`
 * landen kann.
 *
 * Nur die Teilmenge, die der Konverter erzeugt. Was hier fehlt
 * (`modifyHeaders`, `upgradeScheme`), erzeugt er auch nicht.
 */

export type DnrRessource =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

export type DnrAktionTyp = 'block' | 'allow' | 'allowAllRequests' | 'redirect';

/**
 * `redirect` traegt immer einen `extensionPath` - eine Datei aus dem Paket.
 * Auf eine fremde Adresse umzuleiten waere ein Umweg ueber das Netz und
 * genau das, was eine Attrappe vermeiden soll.
 */
export type DnrAktion =
  | { type: 'block' | 'allow' | 'allowAllRequests' }
  | { type: 'redirect'; redirect: { extensionPath: string } };

export type DnrBedingung = {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  resourceTypes?: DnrRessource[];
  excludedResourceTypes?: DnrRessource[];
  domainType?: 'firstParty' | 'thirdParty';
};

export type DnrRegel = {
  id: number;
  priority: number;
  action: DnrAktion;
  condition: DnrBedingung;
};

/** Alle Ressourcentypen, die Chrome kennt; zur Schemaprüfung. */
export const DNR_RESSOURCEN: readonly DnrRessource[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];
