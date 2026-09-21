/**
 * Die Listen frisch halten, ohne auf ein Store-Release zu warten.
 *
 * ── Das Problem, das es loest ──────────────────────────────────────────────
 * Unter Manifest V3 liegen Filterregeln als STATISCHE Rulesets im Paket. Eine
 * neue Fassung von EasyList erreicht den Kunden deshalb erst mit dem naechsten
 * Release, und das geht durch fuenf Store-Pruefungen. Zwischen zwei Freigaben
 * altern die Listen, waehrend Werbenetze taeglich neue Server eintragen.
 *
 * ── Warum ueber das eigene Backend und nicht direkt bei easylist.to ───────
 * Beides taete dasselbe. Der Unterschied ist, wie oft.
 *
 * Direkt: einmal je Kunde und Tag. Bei tausend Kunden waeren das tausend
 * Abrufe derselben Dateien bei Leuten, die sie kostenlos bereitstellen - und
 * tausendmal dieselbe Rechnerei (Liste lesen, umwandeln, vergleichen) auf
 * fremden Geraeten, fuer ein Ergebnis, das fuer alle identisch ist.
 *
 * Ueber den Server: `scripts/listenpflege.mjs` holt die Quellen EINMAL am Tag,
 * rechnet das Delta aus und legt es ab; `GET /api/adsilence/listen/delta`
 * liefert es. Die Erweiterung holt eine kleine, fertige Datei.
 *
 * Der Preis ist ehrlich zu nennen: Damit weiss unser Server, dass irgendwo ein
 * Blocker laeuft. Die Anfrage traegt kein Token, kein Konto und kein Cookie -
 * sie ist fuer alle dieselbe, und es gibt nichts zu personalisieren. Aber sie
 * geht an UNS, und das ist mehr als eine oeffentliche Datei bei einem Dritten.
 * Der Gegenwert ist eine Anfrage statt neun, und Listenpfleger, die nicht
 * unsere Kundenzahl als Last abbekommen.
 *
 * ── Warum nur der Zuwachs ──────────────────────────────────────────────────
 * Firefox erlaubt 5000 dynamische Regeln, und davon sind 1000 fuer
 * Seitenausnahmen und 2999 fuer eigene Regeln vergeben. Es bleiben tausend.
 * Die Listen ganz zu ersetzen braeuchte ueber 22000 - das geht nicht, in
 * keinem Browser gleich. Der Zuwachs zwischen zwei Releases ist dagegen klein.
 */

import { api } from '../gemeinsam/browser.ts';
import {
  API_BASIS,
  BUDGET_LISTENPFLEGE,
  ID_LISTENPFLEGE_VON,
  LISTENPFLEGE_UEBERFAELLIG_MS,
} from '../gemeinsam/konstanten.ts';
import { liesLokal, schreibeLokal } from '../gemeinsam/speicher.ts';
import type { DnrRegel } from '../engine/dnr-typen.ts';
import { lizenzWirksam } from './lizenz-regeln.ts';

/** Wie lange der Abruf hoechstens dauern darf. */
const ZEIT_MS = 20_000;

export type Ergebnis = {
  /** Wie viele Regeln nachgetragen wurden. */
  neu: number;
  /** Wie viele der Server nicht mehr ins Budget bekam. */
  uebergangen: number;
  /** Welche Listen im Delta stecken. */
  gelesen: string[];
  /** Leer, solange der Abruf klappt; sonst der Grund. */
  fehlend: string[];
};

type Delta = {
  paketstand: string;
  gebautAm: string;
  regeln: Omit<DnrRegel, 'id'>[];
  jeListe: Record<string, number>;
  uebergangen: number;
};

/**
 * Ist der letzte Lauf zu lange her?
 *
 * Reine Funktion auf dem gespeicherten Stand, damit ein Test sie ohne Browser
 * fahren kann. `null` als Stand heisst „noch nie gelaufen" und ist immer
 * ueberfaellig.
 */
export function istUeberfaellig(am: string | null | undefined, jetzt: number, grenzeMs: number): boolean {
  if (!am) return true;
  const zeit = Date.parse(am);
  if (!Number.isFinite(zeit)) return true;
  return jetzt - zeit > grenzeMs;
}

/**
 * Beim Start nachholen, wenn der letzte Lauf zu lange her ist.
 *
 * Der Alarm feuert nur, solange der Browser laeuft; ein Rechner, der eine
 * Woche aus war, haette sonst eine Woche alte Listen und merkte es nicht.
 */
export async function pflegeNachholen(): Promise<Ergebnis | null> {
  const { listenPflegeStand } = await liesLokal('listenPflegeStand');
  if (!istUeberfaellig(listenPflegeStand?.am, Date.now(), LISTENPFLEGE_UEBERFAELLIG_MS)) return null;
  return pflegeListen();
}

async function holeDelta(): Promise<Delta | null> {
  const steuerung = new AbortController();
  const wecker = setTimeout(() => steuerung.abort(), ZEIT_MS);
  try {
    const antwort = await fetch(`${API_BASIS}/api/adsilence/listen/delta`, {
      signal: steuerung.signal,
      credentials: 'omit',
      cache: 'no-cache',
    });
    if (!antwort.ok) return null;
    const daten = (await antwort.json()) as Delta;
    return Array.isArray(daten?.regeln) ? daten : null;
  } catch {
    return null;
  } finally {
    clearTimeout(wecker);
  }
}

/**
 * Einmal nachziehen.
 *
 * Gibt `null` zurueck, wenn gar nicht gepflegt werden soll - das ist der
 * Normalfall ohne Premium und der einzige, in dem keine Anfrage rausgeht.
 */
/**
 * Einen Fehlversuch vermerken, ohne den letzten Erfolg zu ueberschreiben.
 *
 * `fehlend` wurde bisher gebildet und zurueckgegeben, aber nie gespeichert —
 * die Optionsseite zeigte nach einem gescheiterten Abruf unveraendert das alte
 * Erfolgsdatum, als waere alles in Ordnung.
 *
 * `am` bleibt stehen: Daran rechnet `istUeberfaellig()`, und ein Fehlversuch,
 * der das Datum vorstellt, verhindert den naechsten Versuch fuer 26 Stunden.
 * Gab es noch nie einen Erfolg, wird gar nichts geschrieben — „nie gelaufen"
 * sagt der fehlende Stand schon selbst.
 */
async function merkeFehlschlag(grund: 'abruf' | 'schreiben'): Promise<void> {
  const { listenPflegeStand } = await liesLokal('listenPflegeStand');
  if (!listenPflegeStand) return;
  await schreibeLokal({
    listenPflegeStand: { ...listenPflegeStand, fehlend: [grund], fehlgeschlagenAm: new Date().toISOString() },
  });
}

export async function pflegeListen(): Promise<Ergebnis | null> {
  const { einstellungen, lizenz } = await liesLokal('einstellungen', 'lizenz');
  if (!einstellungen.aktiv || !einstellungen.listenPflege) return null;
  if (!lizenzWirksam(lizenz, Date.now()).premium) return null;

  const dnr = api.declarativeNetRequest as typeof chrome.declarativeNetRequest | undefined;
  if (!dnr) return null;

  const delta = await holeDelta();
  if (!delta) {
    // Kein Abruf, kein Schaden: Die Regeln bleiben stehen. Ein Ausfall darf
    // nicht dazu fuehren, dass nachgetragene Regeln verschwinden — sichtbar
    // sein muss er trotzdem.
    await merkeFehlschlag('abruf');
    return { neu: 0, uebergangen: 0, gelesen: [], fehlend: ['abruf'] };
  }

  const passen = delta.regeln.slice(0, BUDGET_LISTENPFLEGE);
  const mitId = passen.map((r, i) => ({ ...r, id: ID_LISTENPFLEGE_VON + i }));

  try {
    const alte = await dnr.getDynamicRules();
    const weg = alte
      .filter((r) => r.id >= ID_LISTENPFLEGE_VON && r.id < ID_LISTENPFLEGE_VON + BUDGET_LISTENPFLEGE)
      .map((r) => r.id);
    await dnr.updateDynamicRules({ removeRuleIds: weg, addRules: mitId as chrome.declarativeNetRequest.Rule[] });
  } catch (e) {
    console.warn('[AdSilence] Listenpflege', e);
    await merkeFehlschlag('schreiben');
    return { neu: 0, uebergangen: delta.regeln.length, gelesen: Object.keys(delta.jeListe), fehlend: ['schreiben'] };
  }

  const ergebnis: Ergebnis = {
    neu: mitId.length,
    uebergangen: delta.uebergangen + (delta.regeln.length - passen.length),
    gelesen: Object.keys(delta.jeListe),
    fehlend: [],
  };
  // Kein `fehlgeschlagenAm`: Ein Erfolg loescht den Vermerk, indem er ihn nicht mitschreibt.
  await schreibeLokal({ listenPflegeStand: { am: new Date().toISOString(), ...ergebnis } });
  return ergebnis;
}
