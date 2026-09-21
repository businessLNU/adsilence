/**
 * Die eine Stelle, an der Popup und Optionsseite mit dem Hintergrund und
 * dem Speicher sprechen. Bauteile rufen `sende()`, `leseSpeicher()`,
 * `beiSpeicherAenderung()`, `oeffneTab()`; sie sehen `chrome.*` nie selbst.
 *
 * Ohne `api.runtime` (Vite-Vorschau im normalen Browser) und mit
 * `?attrappe=…` in der URL antwortet `attrappe.ts`. Ohne beides wirft jede
 * Nachricht `HINTERGRUND_FEHLT`, und die Seite zeigt den Fehlerzustand.
 */

import { api, apiVorhanden } from '../gemeinsam/browser.ts';
import type { Verdacht } from '../gemeinsam/phishing.ts';
import { liesLokal, schreibeLokal } from '../gemeinsam/speicher.ts';
import { API_BASIS, BROWSER, VERSION } from '../gemeinsam/konstanten.ts';
import type {
  Antwort,
  KosmetikAntwort,
  Lizenz,
  MeldungVorschau,
  Nachricht,
  SpeicherLokal,
  Tarifliste,
  Zustand,
} from '../gemeinsam/typen.ts';
import {
  attrappeBeiAenderung,
  attrappeEinrichten,
  attrappeLies,
  attrappeSchreibe,
  attrappeSende,
  attrappeVariante,
} from './attrappe.ts';

/** Antwortform je Nachrichtentyp (vertrag.md 7), ohne das `ok`-Feld. */
export type Antworten = {
  zustand: Zustand;
  'aktiv.setzen': Record<string, never>;
  'site.setzen': Record<string, never>;
  'liste.setzen': Record<string, never>;
  'konto.verbinden': { code: string; verbindenUrl: string };
  'konto.trennen': Record<string, never>;
  'lizenz.pruefen': { lizenz: Lizenz };
  'premium.kaufen': { url: string };
  'tarife.holen': Tarifliste;
  'meldung.vorschau': MeldungVorschau;
  'meldung.senden': { id: string };
  'regeln.eigene.setzen': { anzahl: number; fehler: string[] };
  'abgleich.jetzt': { aktualisiertAm: string };
  kosmetik: KosmetikAntwort;
  'kosmetik.generisch': { css: string };
  // Beides `null`, wenn nichts auffaellt - das ist der Normalfall.
  'verwechslung.pruefen': { verdacht: Verdacht | null; texte: Record<string, string> | null };
  // `null`, wenn nicht geklickt werden soll - der Normalfall.
  'cookies.antwort': { antwort: 'annehmen' | 'ablehnen' | null };
  // `null`, wenn die Pflege gar nicht laufen darf.
  'listen.pflegen': { ergebnis: { neu: number; uebergangen: number; gelesen: string[]; fehlend: string[] } | null };
};

/**
 * Ein Fehler aus einer Antwort `{ ok: false, code }` oder vom Transport.
 * Bewusst KEINE Parameter-Eigenschaft im Konstruktor: Node fuehrt die Datei
 * in Tests ohne Uebersetzer aus, und nur loeschbare Syntax ueberlebt das.
 */
export class NachrichtFehler extends Error {
  readonly code: string;
  /** Klartext aus dem Hintergrund, unuebersetzt. Fuer die Fehlersuche. */
  readonly grund: string | undefined;
  constructor(code: string, grund?: string) {
    super(grund ? `${code}: ${grund}` : code);
    this.name = 'NachrichtFehler';
    this.code = code;
    this.grund = grund;
  }
}

const laeuftImPaket = apiVorhanden && typeof api.runtime?.sendMessage === 'function';
const variante = laeuftImPaket ? null : attrappeVariante();
if (variante) attrappeEinrichten(variante);

export const istAttrappe = variante !== null;

export const UMGEBUNG = { apiBasis: API_BASIS, version: VERSION, browser: BROWSER } as const;

export async function sende<T extends Nachricht['typ']>(
  nachricht: Extract<Nachricht, { typ: T }>,
): Promise<Antworten[T]> {
  let antwort: Antwort<Antworten[T]> | undefined;
  if (variante) {
    antwort = await attrappeSende(nachricht, variante);
  } else if (laeuftImPaket) {
    try {
      antwort = (await api.runtime.sendMessage(nachricht)) as Antwort<Antworten[T]> | undefined;
    } catch {
      throw new NachrichtFehler('HINTERGRUND_FEHLT');
    }
  }
  // `undefined` heisst: niemand hat zugehoert. Der Service Worker ist nicht
  // gestartet oder hat den Typ nicht registriert. Beides ist derselbe Fall.
  if (!antwort) throw new NachrichtFehler('HINTERGRUND_FEHLT');
  if (!antwort.ok) throw new NachrichtFehler(antwort.code, antwort.grund);
  return antwort;
}

export async function leseSpeicher<K extends keyof SpeicherLokal>(
  ...schluessel: K[]
): Promise<Pick<SpeicherLokal, K>> {
  if (variante) return attrappeLies(...schluessel);
  return liesLokal(...schluessel);
}

export async function schreibeSpeicher(teil: Partial<SpeicherLokal>): Promise<void> {
  if (variante) return attrappeSchreibe(teil);
  return schreibeLokal(teil);
}

/** Ruft `cb` mit den neuen Werten, sobald `storage.local` sich aendert. */
export function beiSpeicherAenderung(cb: (aenderungen: Partial<SpeicherLokal>) => void): () => void {
  if (variante) return attrappeBeiAenderung(cb);
  if (!laeuftImPaket || !api.storage?.onChanged) return () => {};
  const zuhoerer = (
    aenderungen: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    bereich: string,
  ) => {
    if (bereich !== 'local') return;
    const neu: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(aenderungen)) neu[k] = v.newValue;
    cb(neu as Partial<SpeicherLokal>);
  };
  api.storage.onChanged.addListener(zuhoerer);
  return () => api.storage.onChanged.removeListener(zuhoerer);
}

/** Oeffnet eine Adresse in einem neuen Tab. In der Vorschau: neues Fenster. */
export async function oeffneTab(url: string): Promise<void> {
  if (laeuftImPaket && api.tabs?.create) {
    await api.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/**
 * Oeffnet die Optionsseite, wahlweise auf einem Bereich (`#konto`).
 * `openOptionsPage` kennt keinen Anker, deshalb bei Bereich der Umweg ueber
 * die eigene Adresse.
 */
export async function oeffneOptionen(bereich?: string): Promise<void> {
  if (laeuftImPaket) {
    if (!bereich && api.runtime.openOptionsPage) {
      await api.runtime.openOptionsPage();
      return;
    }
    await oeffneTab(api.runtime.getURL(`optionen/index.html${bereich ? '#' + bereich : ''}`));
    return;
  }
  const url = new URL('../optionen/index.html', location.href);
  url.search = location.search;
  if (bereich) url.hash = bereich;
  window.open(url.toString(), '_blank', 'noopener');
}

/** Die ID des Tabs, fuer den das Popup steht. Ohne Paket: keine. */
export async function aktiverTabId(): Promise<number | undefined> {
  if (!laeuftImPaket || !api.tabs?.query) return undefined;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  } catch {
    return undefined;
  }
}

/** Adresse einer Datei im Paket, etwa des Symbols. Ohne Paket: relativ. */
export function paketUrl(pfad: string): string {
  if (laeuftImPaket && api.runtime?.getURL) return api.runtime.getURL(pfad);
  return new URL('../' + pfad, location.href).toString();
}
