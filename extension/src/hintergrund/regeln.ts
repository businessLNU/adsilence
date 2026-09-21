/**
 * Alles, was `declarativeNetRequest` und registrierte Stylesheets anfasst:
 * statische Rulesets schalten, dynamische Regeln (Ausnahmen je Host, eigene
 * Regeln) neu aufbauen, generische Kosmetik je Liste als Inhaltsskript
 * registrieren.
 *
 * Fehler werden zu Zustaenden, nicht zu Abstuerzen: Passt eine Liste nicht
 * mehr ins Kontingent des Browsers, steht ihre ID in `listenFehler`, und die
 * Oberflaeche sagt es. Alles andere laeuft weiter.
 */

import { api } from '../gemeinsam/browser.ts';
import { BUDGET_EIGENE, ID_EIGENE_VON, ID_LISTENPFLEGE_VON, INHALT_CSS_ID, LISTEN_VORGABE } from '../gemeinsam/konstanten.ts';
import { liesLokal, schreibeLokal, schreibeSitzung } from '../gemeinsam/speicher.ts';
import type { Einstellungen, Lizenz } from '../gemeinsam/typen.ts';
import { eigeneRegeln, zuDnr } from '../engine/index.ts';
import { ausschlussMuster, baueAusnahmen } from './ausnahmen.ts';
import { lizenzWirksam } from './lizenz-regeln.ts';

export type ListeInfo = {
  id: string;
  name: string;
  premium: boolean;
  standard: boolean;
  /** DNR-Regeln laut `listen/bericht.json`; null, wenn der Bericht fehlt. */
  regeln: number | null;
  /** Bei einer regionalen Liste der Sprachcode, sonst `undefined`. */
  sprache?: string;
};

type Dnr = typeof chrome.declarativeNetRequest;

// Der Service Worker lebt kurz; was er einmal gelesen hat, behaelt er, bis
// der Browser ihn beendet. Danach liest er es eben noch einmal.
let listenMerker: Promise<ListeInfo[]> | null = null;
const cssMerker = new Map<string, Promise<boolean>>();

/**
 * Eine Datei aus dem eigenen Paket lesen. Die EINE Stelle dafuer neben
 * `paketDateiVorhanden`: `tests/hintergrund/pruefe-netz.test.ts` zaehlt die
 * Paketzugriffe und will, dass jemand hinsieht, sobald es mehr werden. Wer
 * eine weitere Paketdatei braucht, ruft diese Funktion, statt selbst `fetch`
 * zu schreiben.
 */
export async function holePaketText(pfad: string): Promise<string | null> {
  try {
    const antwort = await fetch(api.runtime.getURL(pfad));
    if (!antwort.ok) return null;
    return await antwort.text();
  } catch {
    return null;
  }
}

export async function holePaketJson<T>(pfad: string): Promise<T | null> {
  const text = await holePaketText(pfad);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Gibt es diese Datei im Paket? Einmal je Pfad gefragt. */
export function paketDateiVorhanden(pfad: string): Promise<boolean> {
  let merker = cssMerker.get(pfad);
  if (!merker) {
    merker = fetch(api.runtime.getURL(pfad), { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false);
    cssMerker.set(pfad, merker);
  }
  return merker;
}

/**
 * Welche Listen es gibt: Namen und Premium-Kennzeichen aus
 * `listen/quellen.json`, Regelzahlen aus `listen/bericht.json`, gefiltert auf
 * das, was das Manifest wirklich als Ruleset kennt. Fehlt eine Datei, gilt
 * die Tabelle aus den Konstanten.
 */
export function listenInfo(): Promise<ListeInfo[]> {
  if (!listenMerker) listenMerker = ladeListenInfo();
  return listenMerker;
}

async function ladeListenInfo(): Promise<ListeInfo[]> {
  type Quelle = { id: string; name: string; premium?: boolean; standard?: boolean; sprache?: string };
  const [quellen, bericht] = await Promise.all([
    holePaketJson<Quelle[]>('listen/quellen.json'),
    holePaketJson<Record<string, { dnr?: number }>>('listen/bericht.json'),
  ]);
  const basis: readonly Quelle[] = Array.isArray(quellen) && quellen.length > 0 ? quellen : LISTEN_VORGABE;

  const manifest = api.runtime.getManifest() as { declarative_net_request?: { rule_resources?: { id: string }[] } };
  const imManifest = new Set((manifest.declarative_net_request?.rule_resources ?? []).map((r) => r.id));

  return basis
    .filter((q) => imManifest.has(q.id))
    .map((q) => {
      const vorgabe = LISTEN_VORGABE.find((v) => v.id === q.id);
      return {
        id: q.id,
        name: String(q.name ?? q.id),
        premium: Boolean(q.premium ?? vorgabe?.premium ?? false),
        standard: Boolean(q.standard ?? vorgabe?.standard ?? false),
        regeln: typeof bericht?.[q.id]?.dnr === 'number' ? bericht[q.id]!.dnr! : null,
        sprache: q.sprache ?? vorgabe?.sprache,
      };
    });
}

/**
 * Welche Listen wirken sollen: global an, vom Nutzer gewollt (oder Standard,
 * solange er nichts gesagt hat), und Premium nur mit wirksamer Lizenz.
 * Reine Funktion; die Tests fahren sie ohne Browser.
 */
/**
 * Welche regionale Liste passt zu dieser Browsersprache?
 *
 * Verglichen wird auf dem GRUNDCODE: `de-AT` und `de-CH` finden beide die
 * deutsche Liste. Gibt es keine passende, kommt `null` - dann bleibt es bei
 * den Standardlisten, und niemand bekommt eine Liste in einer Sprache, die er
 * nicht liest.
 */
export function regionalFuerSprache(sprache: string, listen: readonly ListeInfo[]): string | null {
  const grund = sprache.toLowerCase().split('-')[0] ?? '';
  if (!grund) return null;
  return listen.find((l) => l.sprache === grund)?.id ?? null;
}

/**
 * Beim ERSTEN Einrichten die regionale Liste der Browsersprache anschalten.
 *
 * ── Warum automatisch ──────────────────────────────────────────────────────
 * Eine regionale Liste hilft nur dem, der die Sprache liest, und schadet
 * sonst niemandem - sie kostet nur Regelkontingent. Wer auf deutschen Seiten
 * surft, will die deutschen Regeln, und er sollte sie nicht erst in einer
 * Liste von achtzehn suchen muessen. Was der Browser als Sprache meldet, ist
 * die beste Vermutung, die es ohne Nachfrage gibt.
 *
 * ── Warum nur beim ersten Mal ──────────────────────────────────────────────
 * Danach nie wieder: Wer die Liste abschaltet, hat das so gemeint. Eine
 * Automatik, die eine Entscheidung des Nutzers beim naechsten Start
 * ueberschreibt, ist keine Hilfe mehr, sondern ein Fehler, den er nicht
 * abstellen kann. Der Merker dafuer ist `einstellungen.listen`: Solange dort
 * kein einziger Eintrag steht, hat noch niemand etwas entschieden.
 */
export async function waehleRegionaleListe(): Promise<string | null> {
  const { einstellungen } = await liesLokal('einstellungen');
  if (Object.keys(einstellungen.listen).length > 0) return null;

  let sprache = '';
  try {
    sprache = api.i18n?.getUILanguage?.() ?? '';
  } catch {
    return null;
  }
  const passend = regionalFuerSprache(sprache, await listenInfo());
  if (!passend) return null;

  await schreibeLokal({ einstellungen: { ...einstellungen, listen: { [passend]: true } } });
  return passend;
}

export function aktiveListenIds(einstellungen: Einstellungen, lizenz: Lizenz, listen: readonly ListeInfo[]): string[] {
  if (!einstellungen.aktiv) return [];
  return listen
    .filter((l) => {
      const gewollt = einstellungen.listen[l.id] ?? l.standard;
      return gewollt && (!l.premium || lizenz.premium);
    })
    .map((l) => l.id);
}

export async function aktiveListen(): Promise<string[]> {
  const [{ einstellungen, lizenz }, listen] = await Promise.all([liesLokal('einstellungen', 'lizenz'), listenInfo()]);
  return aktiveListenIds(einstellungen, lizenzWirksam(lizenz, Date.now()), listen);
}

/**
 * Statische Rulesets auf den Sollzustand bringen.
 *
 * Vorher `getAvailableStaticRuleCount()`: Der Browser garantiert 30 000
 * Regeln, mehr je nach Kontingent. Eine Liste, die nicht mehr passt, wird
 * nicht eingeschaltet und landet in `listenFehler`; alle anderen kommen
 * trotzdem. Ein einziger Aufruf fuer alles waere schneller, aber wenn er
 * scheitert, weiss niemand, welche Liste schuld war.
 */
export async function schalteRulesets(): Promise<void> {
  const dnr: Dnr | undefined = api.declarativeNetRequest;
  if (!dnr) return;
  const listen = await listenInfo();
  const soll = new Set(await aktiveListen());

  let aktuell: string[] = [];
  try {
    aktuell = await dnr.getEnabledRulesets();
  } catch {
    aktuell = [];
  }

  const ein = listen.map((l) => l.id).filter((id) => soll.has(id) && !aktuell.includes(id));
  // `eigenschutz` ist keine Filterliste, sondern die eine Ausnahme, die uns
  // vor unseren eigenen Regeln bewahrt: Sie laesst die Verbindung zur eigenen
  // API durch. Sie steht deshalb nicht in `LISTEN_VORGABE` - und genau deshalb
  // haette diese Zeile sie ausgeschaltet, keine Sekunde nach dem Start.
  //
  // GEMESSEN am 04.09.2026: Das Manifest hatte sie an, die Erweiterung schaltete
  // sie sofort wieder ab, und die taegliche Listenpflege erreichte ihr Backend
  // nicht mehr. Im Log stand nichts; `holeDelta()` faengt den Fehler ab und
  // gibt `null` zurueck, damit ein Netzausfall keine Regeln loescht.
  const aus = aktuell.filter((id) => !soll.has(id) && id !== 'eigenschutz');
  let fehler: string | null = null;

  if (aus.length) {
    try {
      await dnr.updateEnabledRulesets({ disableRulesetIds: aus });
    } catch (e) {
      console.warn('[AdSilence] Ruleset ausschalten', e);
    }
  }

  let frei = Number.POSITIVE_INFINITY;
  if (typeof dnr.getAvailableStaticRuleCount === 'function') {
    try {
      frei = await dnr.getAvailableStaticRuleCount();
    } catch {
      frei = Number.POSITIVE_INFINITY;
    }
  }

  for (const id of ein) {
    const bedarf = listen.find((l) => l.id === id)?.regeln ?? 0;
    if (bedarf > frei) {
      fehler = id;
      continue;
    }
    try {
      await dnr.updateEnabledRulesets({ enableRulesetIds: [id] });
      frei -= bedarf;
    } catch (e) {
      console.warn('[AdSilence] Ruleset einschalten', id, e);
      fehler = id;
    }
  }

  await schreibeSitzung({ listenFehler: fehler });
}

/**
 * Eigene Regeln (ABP-Syntax) → DNR. Der Konverter ist derselbe wie im Build;
 * er wirft nicht, aber falls doch, wird daraus eine Fehlerzeile statt eines
 * toten Service Workers.
 */
export function eigeneDnr(text: string): { rules: chrome.declarativeNetRequest.Rule[]; anzahl: number; fehler: string[] } {
  if (!text.trim()) return { rules: [], anzahl: 0, fehler: [] };
  try {
    const gelesen = eigeneRegeln(text);
    const { rules, quellregeln } = zuDnr(gelesen.regeln, { startId: ID_EIGENE_VON, budget: BUDGET_EIGENE });
    // `quellregeln` und NICHT `rules.length`: Der Konverter legt reine
    // Host-Regeln zu einer DNR-Regel mit mehreren `requestDomains` zusammen.
    //
    // GEMESSEN am 03.09.2026 an der geladenen Erweiterung: Zwei eingetippte
    // Zeilen (`||werbung.beispiel.de^` und `||tracker.beispiel.de^`) ergaben
    // EINE DNR-Regel, und die Optionsseite meldete daraufhin „1 Regel aktiv".
    // Der Nutzer hat zwei geschrieben, beide wirken, und die Zahl sagte etwas
    // anderes. Die Zusammenlegung ist richtig (sie spart Kontingent), nur ist
    // sie nichts, was jemand ausserhalb der Engine wissen will.
    return { rules, anzahl: quellregeln, fehler: gelesen.fehler.map((f) => `${f.zeile}: ${f.grund}`) };
  } catch (e) {
    return { rules: [], anzahl: 0, fehler: [`0: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

/**
 * Ausnahmen und eigene Regeln neu setzen — und NUR die.
 *
 * Die IDs teilen sich in drei Bereiche (`konstanten.ts`): Ausnahmen 1–999,
 * eigene Regeln 1001–1999, und ab `ID_LISTENPFLEGE_VON` der taegliche
 * Nachschub, 2000–4999. Die ersten beiden gehoeren dieser Funktion, der
 * dritte gehoert der Listenpflege.
 *
 * ── Der Fehler, gegen den das Filter steht ────────────────────────────────
 * Hier stand `removeRuleIds: alt.map((r) => r.id)` — ALLE dynamischen Regeln,
 * also auch die 3000 nachgeladenen. Wieder eingesetzt wurden nur Ausnahmen
 * und eigene; der Nachschub blieb weg, bis `pflegeNachholen()` ihn nach 26
 * Stunden erneut holte.
 *
 * Aufgerufen wird diese Funktion bei jedem Browserstart, bei jeder
 * Seitenausnahme, bei jeder eigenen Regel und nach jedem Kontoabgleich. Wer
 * morgens startete und mittags eine Seite auf die Ausnahmeliste setzte, hatte
 * den bezahlten Nachschub bis zum naechsten Tag verloren — ohne dass irgendwo
 * etwas davon stand.
 *
 * Ein Lauf, ein Ergebnis: innerhalb der eigenen Bereiche wird weiter alles
 * ersetzt statt einzeln abgeglichen, damit ein Absturz mittendrin keine Reste
 * laesst.
 */
export async function aktualisiereDynamischeRegeln(): Promise<{ anzahl: number; fehler: string[] }> {
  const dnr: Dnr | undefined = api.declarativeNetRequest;
  const { sites, eigeneRegeln: text } = await liesLokal('sites', 'eigeneRegeln');
  const eigene = eigeneDnr(text);
  if (!dnr) return { anzahl: eigene.anzahl, fehler: eigene.fehler };

  const neu = [...baueAusnahmen(sites), ...eigene.rules];
  try {
    const alt = await dnr.getDynamicRules();
    const weg = alt.filter((r) => r.id < ID_LISTENPFLEGE_VON).map((r) => r.id);
    await dnr.updateDynamicRules({ removeRuleIds: weg, addRules: neu });
  } catch (e) {
    console.warn('[AdSilence] dynamische Regeln', e);
    eigene.fehler.push(`0: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { anzahl: eigene.anzahl, fehler: eigene.fehler };
}

/**
 * Generische Kosmetik als registriertes Inhaltsskript (nur CSS), eines je
 * aktiver Liste: `kosmetik/<id>.generisch.css`, vom Build aus
 * `kosmetik/<id>.json` erzeugt.
 *
 * Warum nicht `content_scripts.css` im Manifest: Das laesst sich weder je
 * Host noch global abschalten. Eine Ausnahme fuer eine Seite waere dann nur
 * halb eine, und „AdSilence aus" hiesse weiter versteckte Elemente. Ein
 * registriertes Skript kennt `excludeMatches`, und es laeuft genauso frueh.
 */
export async function aktualisiereGenerischesCss(): Promise<void> {
  const scripting = api.scripting as typeof chrome.scripting | undefined;
  if (!scripting || typeof scripting.registerContentScripts !== 'function') return;

  const [{ einstellungen, sites }, listen, aktiv] = await Promise.all([liesLokal('einstellungen', 'sites'), listenInfo(), aktiveListen()]);
  const aktivSet = new Set(aktiv);
  const ausschluss = ausschlussMuster(sites);

  let vorhanden = new Set<string>();
  try {
    const alle = await scripting.getRegisteredContentScripts();
    vorhanden = new Set(alle.map((s) => s.id).filter((id) => id.startsWith(INHALT_CSS_ID)));
  } catch {
    vorhanden = new Set();
  }

  const soll: chrome.scripting.RegisteredContentScript[] = [];
  if (einstellungen.aktiv) {
    for (const liste of listen) {
      if (!aktivSet.has(liste.id)) continue;
      const pfad = `kosmetik/${liste.id}.generisch.css`;
      if (!(await paketDateiVorhanden(pfad))) continue;
      soll.push({
        id: `${INHALT_CSS_ID}-${liste.id}`,
        matches: ['<all_urls>'],
        // Leer heisst leer: Beim Aktualisieren bleibt ein weggelassenes Feld
        // sonst auf dem alten Wert stehen.
        excludeMatches: ausschluss,
        css: [pfad],
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
      console.warn('[AdSilence] CSS abmelden', e);
    }
  }

  const neu = soll.filter((s) => !vorhanden.has(s.id));
  const aendern = soll.filter((s) => vorhanden.has(s.id));
  try {
    if (aendern.length) await scripting.updateContentScripts(aendern);
    if (neu.length) await scripting.registerContentScripts(neu);
  } catch (e) {
    // Meist: die CSS-Datei fehlt im Paket (Build ohne Listen). Dann eben ohne
    // generische Kosmetik; die spezifische kommt weiter per Nachricht.
    console.warn('[AdSilence] CSS registrieren', e);
  }
}
