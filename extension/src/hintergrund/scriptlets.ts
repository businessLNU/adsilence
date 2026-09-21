/**
 * Scriptlets — die Gegenmittel gegen Adblock-Erkennung.
 *
 * ── Der Weg, der zaehlt: registrierte Inhaltsskripte ──────────────────────
 * `aktualisiereScriptletSkripte()` meldet je aktiver Liste ein Inhaltsskript
 * an (`scriptlets/<id>.js`, vom Build erzeugt), mit `world: 'MAIN'` und
 * `runAt: 'document_start'`. Der Browser injiziert es dann SELBST, ohne den
 * Service Worker zu fragen.
 *
 * ── Warum der alte Weg nicht reichte ─────────────────────────────────────
 * Bis zum 08.09.2026 lief alles ueber `executeScript` bei
 * `webNavigation.onCommitted`. Ein schlafender Worker muss dafuer geweckt
 * werden, Module laden, Speicher lesen — und in dieser Zeit hat das erste
 * Seitenskript schon gelesen, was es lesen wollte.
 *
 *   GEMESSEN in echtem Chrome (`npm run probe:erkennung`):
 *     vor dem ersten Seitenskript (70 ms):  NEIN
 *     nach 400 ms:                          ja
 *
 * Und zwar KALT wie WARM. Es war also nicht einmal ein Wettlauf, den man
 * manchmal gewinnt: Der Weg kam systematisch zu spaet. Der Katalog fuehrte
 * das seit Monaten als offenen Punkt (32-browser-erweiterung.md:908-911) —
 * gemessen hatte es niemand.
 *
 * ── Warum der alte Weg trotzdem bleibt ───────────────────────────────────
 * Safari kennt `world: 'MAIN'` beim REGISTRIEREN nicht sicher (Katalog 32).
 * Schlaegt die Registrierung fehl, bleibt der Lauscher der einzige Weg — spaet
 * ist besser als nie. Gelingt sie, kehrt `beiNavigation` sofort zurueck:
 * zweimal dasselbe Scriptlet waere sonst zweimal dieselbe Arbeit auf jeder
 * Seite. (Der Merker `__adsilenceScriptlets` in der Bibliothek verhindert die
 * doppelte WIRKUNG ohnehin — aber nicht die doppelte Arbeit.)
 */

import { api } from '../gemeinsam/browser.ts';
import { INHALT_SCRIPTLET_ID } from '../gemeinsam/konstanten.ts';
import { liesLokal } from '../gemeinsam/speicher.ts';
import { scriptletLoader, type ScriptletEintrag } from '../scriptlets/bibliothek.ts';
import { ausschlussMuster, hostAus, hostKette, siteErlaubt } from './ausnahmen.ts';
import { aktiveListen, holePaketJson, paketDateiVorhanden } from './regeln.ts';

type ScriptletKarte = Record<string, ScriptletEintrag[]>;

let karte: Promise<ScriptletKarte> | null = null;

export function scriptletsNeuLaden(): void {
  karte = null;
}

async function baueKarte(): Promise<ScriptletKarte> {
  const listen = await aktiveListen();
  const k: ScriptletKarte = {};
  const dateien = await Promise.all(listen.map((id) => holePaketJson<ScriptletKarte>(`scriptlets/${id}.json`)));
  for (const datei of dateien) {
    if (!datei || typeof datei !== 'object') continue;
    for (const host of Object.keys(datei)) {
      const eintraege = datei[host];
      if (!Array.isArray(eintraege)) continue;
      (k[host.toLowerCase()] ??= []).push(...eintraege.filter((e) => e && typeof e.name === 'string'));
    }
  }
  return k;
}

function holeKarte(): Promise<ScriptletKarte> {
  if (!karte) {
    karte = baueKarte().catch((e) => {
      karte = null;
      throw e;
    });
  }
  return karte;
}

/** Eintraege fuer den Host und die Domains darueber, ohne Doppelte. */
export function eintraegeAus(k: ScriptletKarte, host: string): ScriptletEintrag[] {
  const gesehen = new Set<string>();
  const ergebnis: ScriptletEintrag[] = [];
  for (const h of hostKette(host)) {
    for (const e of k[h] ?? []) {
      const schluessel = `${e.name} ${(e.args ?? []).join(' ')}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      ergebnis.push({ name: e.name, args: Array.isArray(e.args) ? e.args.map(String) : [] });
    }
  }
  return ergebnis;
}

export async function scriptletsFuer(host: string): Promise<ScriptletEintrag[]> {
  const { einstellungen, sites } = await liesLokal('einstellungen', 'sites');
  if (!einstellungen.aktiv || siteErlaubt(sites, host)) return [];
  try {
    return eintraegeAus(await holeKarte(), host);
  } catch {
    return [];
  }
}

/**
 * Steht die Registrierung? Dann macht der Lauscher unten nichts mehr.
 *
 * Kein Speicherwert, sondern eine Modulvariable: Sie gilt fuer die Lebenszeit
 * des Service Workers, und genau so lange lebt auch der Lauscher. Nach einem
 * Neustart wird sie beim ersten `aktualisiereScriptletSkripte()` neu gesetzt.
 */
let registriert = false;

/**
 * Je aktiver Liste ein Inhaltsskript anmelden — der Weg, der frueh genug ist.
 *
 * Gebaut wie `aktualisiereGenerischesCss()` in `regeln.ts`: vorhandene gegen
 * gewuenschte Kennungen abgleichen, ueberzaehlige abmelden, geaenderte
 * aktualisieren, neue anmelden. Zwei Unterschiede:
 *
 *   `world: 'MAIN'` — ein Scriptlet muss in der Welt der Seite laufen, sonst
 *   sieht das Seitenskript die Falle gar nicht.
 *
 *   Kein `matchAboutBlank` — `about:blank` und `srcdoc` haben keinen eigenen
 *   Host, und die Karte schlaegt ueber `location.hostname` nach. Dort ist
 *   nichts zu finden und nichts zu setzen.
 */
export async function aktualisiereScriptletSkripte(): Promise<void> {
  const scripting = api.scripting as typeof chrome.scripting | undefined;
  if (!scripting || typeof scripting.registerContentScripts !== 'function') return;

  const [{ einstellungen, sites }, aktiv] = await Promise.all([
    liesLokal('einstellungen', 'sites'),
    aktiveListen(),
  ]);
  const ausschluss = ausschlussMuster(sites);

  let vorhanden = new Set<string>();
  try {
    const alle = await scripting.getRegisteredContentScripts();
    vorhanden = new Set(alle.map((s) => s.id).filter((id) => id.startsWith(INHALT_SCRIPTLET_ID)));
  } catch {
    vorhanden = new Set();
  }

  /*
   * Die Dateipruefung fuer ALLE Listen auf einmal, nicht eine nach der
   * anderen. Jede ist ein `fetch` ins eigene Paket; seriell waren das bei zehn
   * aktiven Listen zehn Umlaeufe hintereinander -- vor der Registrierung, also
   * genau in der Zeitspanne, auf die es ankommt.
   */
  const vorhandeneDateien = new Set<string>();
  if (einstellungen.aktiv) {
    await Promise.all(
      aktiv.map(async (id) => {
        if (await paketDateiVorhanden(`scriptlets/${id}.js`)) vorhandeneDateien.add(id);
      }),
    );
  }

  const soll: chrome.scripting.RegisteredContentScript[] = [];
  if (einstellungen.aktiv) {
    for (const id of aktiv) {
      const pfad = `scriptlets/${id}.js`;
      if (!vorhandeneDateien.has(id)) continue;
      soll.push({
        id: `${INHALT_SCRIPTLET_ID}-${id}`,
        matches: ['<all_urls>'],
        // Leer heisst leer: Ein weggelassenes Feld bliebe beim Aktualisieren
        // auf dem alten Wert stehen.
        excludeMatches: ausschluss,
        js: [pfad],
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: true,
      });
    }
  }

  const sollIds = new Set(soll.map((s) => s.id));
  const weg = [...vorhanden].filter((id) => !sollIds.has(id));
  if (weg.length) {
    try {
      await scripting.unregisterContentScripts({ ids: weg });
    } catch (e) {
      console.warn('[AdSilence] Scriptlets abmelden', e);
    }
  }

  const neu = soll.filter((s) => !vorhanden.has(s.id));
  const aendern = soll.filter((s) => vorhanden.has(s.id));
  try {
    if (aendern.length) await scripting.updateContentScripts(aendern);
    if (neu.length) await scripting.registerContentScripts(neu);
    /*
     * Der Lauscher wird still, sobald die Skripte registriert werden konnten.
     * Schlaegt das fehl (Safari kennt `world: 'MAIN'` beim Registrieren nicht
     * sicher), bleibt er der einzige Weg -- spaet ist besser als nie.
     */
    registriert = soll.length > 0;
  } catch (e) {
    // Safari kennt `world: 'MAIN'` beim Registrieren nicht sicher. Dann bleibt
    // es beim Lauscher — spaet ist besser als nie.
    registriert = false;
    console.warn('[AdSilence] Scriptlets registrieren', e);
  }
}

async function beiNavigation(details: { tabId: number; frameId: number; url: string }): Promise<void> {
  // Sind die Skripte registriert, hat der Browser sie laengst injiziert.
  if (registriert) return;
  const host = hostAus(details.url);
  if (!host) return;
  const eintraege = await scriptletsFuer(host);
  if (eintraege.length === 0) return;
  const scripting = api.scripting as typeof chrome.scripting | undefined;
  if (!scripting) return;
  try {
    await scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [details.frameId] },
      world: 'MAIN',
      injectImmediately: true,
      func: scriptletLoader,
      args: [eintraege],
    });
  } catch {
    // Geschuetzte Seiten (Store, interne Seiten) lassen kein Skript zu; der
    // Rahmen kann auch schon wieder weg sein. Beides ist kein Fehler.
  }
}

export function registriereScriptlets(): void {
  const nav = api.webNavigation as typeof chrome.webNavigation | undefined;
  if (!nav) return;
  try {
    nav.onCommitted.addListener(
      (details) => {
        void beiNavigation(details);
      },
      { url: [{ schemes: ['http', 'https'] }] },
    );
  } catch (e) {
    console.warn('[AdSilence] Scriptlets', e);
  }
}
