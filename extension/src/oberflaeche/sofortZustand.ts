/**
 * Der Zustand, den das Popup OHNE den Hintergrund hinbekommt.
 *
 * ── Warum es das gibt ─────────────────────────────────────────────────────
 * Ein Klick auf das Symbol weckt unter Manifest V3 erst den Service Worker.
 * GEMESSEN am 09.09.2026: kalter Worker 1451 ms bis zur Antwort, warmer 75 ms
 * — und solange stand das Popup leer da. Für den Nutzer sieht ein Fenster,
 * das zwei Sekunden nichts zeigt, kaputt aus; er klickt weiter.
 *
 * Alles, was das Popup beim ersten Malen braucht, liegt aber schon im
 * lokalen Speicher und in den Tab-APIs, die einer Erweiterungsseite offen
 * stehen. Diese Funktion liest genau das und baut daraus einen VORLÄUFIGEN
 * Zustand. Er wird gezeichnet, sobald er da ist; die Antwort des
 * Hintergrunds ersetzt ihn danach.
 *
 * ── Was daran vorläufig ist ───────────────────────────────────────────────
 * Die Listennamen kommen aus `LISTEN_VORGABE` statt aus `listen/quellen.json`
 * und tragen keine Regelzahlen (`regeln: null`); der Zähler kommt vom
 * Symbol-Abzeichen statt aus `getMatchedRules`, ist also die Gesamtzahl ohne
 * Aufschlüsselung. Beides ist gut genug, um die Karte zu zeigen, und beides
 * korrigiert die Antwort des Hintergrunds Sekundenbruchteile später.
 *
 * Was hier NICHT passiert: rechnen. Lizenzstand und Ausnahme kommen aus
 * denselben reinen Funktionen wie im Hintergrund (`lizenzWirksam`,
 * `siteErlaubt`) — zwei Wege zu einem Zustand wären einer zu viel.
 */
import { BROWSER, LISTEN_VORGABE, VERSION } from '../gemeinsam/konstanten.ts';
import { api } from '../gemeinsam/browser.ts';
import { liesLokal } from '../gemeinsam/speicher.ts';
import { hostAus, siteErlaubt } from '../hintergrund/ausnahmen.ts';
import { lizenzWirksam } from '../hintergrund/lizenz-regeln.ts';
import type { TabZustand, Zustand } from '../gemeinsam/typen.ts';

/** Der Zähler steht auf dem Symbol; `<<…>>` heisst „Chrome zaehlt selbst". */
async function vomAbzeichen(tabId: number): Promise<number | 'amSymbol' | null> {
  const action = api.action as typeof chrome.action | undefined;
  if (!action || typeof action.getBadgeText !== 'function') return null;
  try {
    const text = await action.getBadgeText({ tabId });
    if (text.startsWith('<<')) return 'amSymbol';
    const zahl = parseInt(text, 10);
    return Number.isFinite(zahl) ? zahl : null;
  } catch {
    return null;
  }
}

async function tabTeil(tabId: number | undefined, sites: Parameters<typeof siteErlaubt>[0]): Promise<TabZustand | null> {
  if (!api.tabs?.query) return null;
  try {
    const tab = tabId !== undefined && api.tabs.get
      ? await api.tabs.get(tabId)
      : (await api.tabs.query({ active: true, currentWindow: true }))[0];
    const host = hostAus(tab?.url);
    if (!tab || !host) return null;
    return {
      host,
      erlaubt: siteErlaubt(sites, host),
      blockiert: tab.id === undefined ? null : await vomAbzeichen(tab.id),
      jeListe: [],
    };
  } catch {
    return null;
  }
}

/** `null`, wenn ausserhalb des Pakets — dann gibt es nichts zu lesen. */
export async function sofortZustand(tabId: number | undefined): Promise<Zustand | null> {
  if (!api?.storage?.local) return null; // ausserhalb des Pakets gibt es nichts zu lesen
  try {
    const lokal = await liesLokal('einstellungen', 'sites', 'konto', 'kontoHinweis', 'lizenz', 'verbindungOffen');
    const jetzt = Date.now();
    const offen = lokal.verbindungOffen && lokal.verbindungOffen.laeuftAb > jetzt ? lokal.verbindungOffen : null;
    return {
      tab: await tabTeil(tabId, lokal.sites),
      aktiv: lokal.einstellungen.aktiv,
      listen: LISTEN_VORGABE.map((l) => ({
        id: l.id,
        name: l.name,
        aktiv: lokal.einstellungen.listen[l.id] ?? l.standard,
        regeln: null,
        premium: l.premium,
        standard: l.standard,
        sprache: l.sprache,
      })),
      konto: {
        verbunden: Boolean(lokal.konto),
        email: lokal.konto?.email ?? undefined,
        name: lokal.konto?.name ?? undefined,
        hinweis: lokal.kontoHinweis,
      },
      lizenz: lizenzWirksam(lokal.lizenz, jetzt),
      verbindung: offen ? { code: offen.code, verbindenUrl: offen.verbindenUrl, laeuftAb: offen.laeuftAb } : null,
      version: VERSION,
      browser: BROWSER,
      einstellungen: lokal.einstellungen,
      listenFehler: null,
      verbindungFehler: null,
    };
  } catch {
    return null;
  }
}
