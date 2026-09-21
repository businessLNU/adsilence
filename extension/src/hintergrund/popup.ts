/**
 * Popunder — der Tab, den niemand geoeffnet hat.
 *
 * `$popup`-Regeln lassen sich nicht als DNR-Regel ausdruecken: Ein Popunder
 * ist kein Netzabruf, den man ablehnen koennte, sondern ein neuer Tab, und
 * eine Navigation im Hauptrahmen zu blocken hiesse, die Seite zu sperren.
 * GEMESSEN ueber alle Quelllisten: 6.613 solcher Zeilen, die bisher restlos
 * weggefallen sind. 4.380 davon sind reine Host-Anker und werden hier zu dem,
 * was der Hintergrund WIRKLICH kann: einen frisch geoeffneten Tab wieder
 * schliessen. Ab Werk aktiv sind 2.709.
 *
 * ── Warum `onCreatedNavigationTarget` und nicht `tabs.onCreated` ──────────
 * `tabs.onCreated` sagt nicht verlaesslich, WOHIN der Tab geht — bei einem
 * Popunder ist `url` leer und `pendingUrl` je nach Zeitpunkt auch.
 * `webNavigation.onCreatedNavigationTarget` feuert genau dann, wenn eine
 * Navigation einen neuen Tab aufmacht, und traegt beides: `sourceTabId` (wer
 * ihn aufmacht) und `url` (wohin).
 *
 * ── Die zweite Runde: Umleitungen ────────────────────────────────────────
 * Ein Popunder kommt selten direkt. Er oeffnet `about:blank` und setzt dann
 * `location`, oder er geht ueber einen Zwischenhost, der per 302 weiterreicht
 * (so GEMESSEN am 08.09.2026 auf aniworld.to, Ziel cruzswim.org). Deshalb
 * wird jeder Tab, den eine Seite aufmacht, zehn Sekunden lang beobachtet,
 * und JEDER Commit im Hauptrahmen wird gegen die Liste gehalten. Der Merker
 * lebt im Arbeitsspeicher des Workers -- ein Popunder folgt seinem Oeffner in
 * Millisekunden, und ein Merker in `storage.session` kostete bei JEDER
 * Navigation einen Speicherzugriff.
 *
 * ── Was NICHT geschlossen wird ───────────────────────────────────────────
 * Ein Tab ohne Oeffner (der Nutzer hat die Adresse selbst eingegeben), ein
 * Tab auf einer Seite mit Ausnahme, und alles, solange der Hauptschalter aus
 * ist. Einen Tab zu schliessen, den jemand wollte, waere schlimmer als ein
 * Popunder.
 */

import { api } from '../gemeinsam/browser.ts';
import { liesLokal } from '../gemeinsam/speicher.ts';
import { hostAus, hostKette, siteErlaubt } from './ausnahmen.ts';
import { aktiveListen, holePaketJson } from './regeln.ts';

type PopupListe = { hosts?: string[]; ausnahmen?: string[] };

let hosts: Promise<Set<string>> | null = null;

/** Nach einer Aenderung an den Listen neu einlesen. */
export function popupsNeuLaden(): void {
  hosts = null;
}

async function baueHosts(): Promise<Set<string>> {
  const menge = new Set<string>();
  const ausnahmen = new Set<string>();
  for (const id of await aktiveListen()) {
    const liste = await holePaketJson<PopupListe>(`popup/${id}.json`);
    if (!liste) continue;
    for (const h of liste.hosts ?? []) menge.add(h);
    for (const h of liste.ausnahmen ?? []) ausnahmen.add(h);
  }
  // Eine Ausnahme in Liste B nimmt einen Host aus Liste A zurueck — sonst
  // haenge die Wirkung an der Reihenfolge, in der die Listen gelesen werden.
  for (const h of ausnahmen) menge.delete(h);
  return menge;
}

function holeHosts(): Promise<Set<string>> {
  hosts ??= baueHosts().catch(() => new Set<string>());
  return hosts;
}

/** Steht der Host — oder einer seiner Oberhosts — auf der Liste? */
async function istPopupZiel(url: string): Promise<boolean> {
  const host = hostAus(url);
  if (host === null) return false;
  const menge = await holeHosts();
  if (menge.size === 0) return false;
  for (const teil of hostKette(host)) if (menge.has(teil)) return true;
  return false;
}

/** Tabs, die eine Seite aufgemacht hat und deren Ziel noch offen ist. */
const beobachtet = new Map<number, number>();

async function darfSchliessen(quelleTabId: number): Promise<boolean> {
  const { einstellungen, sites } = await liesLokal('einstellungen', 'sites');
  if (!einstellungen.aktiv) return false;
  // Die Ausnahme gilt der Seite, die den Tab aufmacht — nicht dem Ziel. Wer
  // AdSilence auf einer Seite abschaltet, will dort auch keine geschlossenen
  // Tabs.
  try {
    const quelle = await api.tabs.get(quelleTabId);
    const host = hostAus(quelle.url ?? quelle.pendingUrl);
    if (host !== null && siteErlaubt(sites, host)) return false;
  } catch {
    // Der oeffnende Tab ist schon weg. Dann gibt es keine Ausnahme zu achten.
  }
  return true;
}

async function schliesse(tabId: number, quelleTabId: number, url: string): Promise<void> {
  if (!(await istPopupZiel(url))) return;
  if (!(await darfSchliessen(quelleTabId))) return;
  beobachtet.delete(tabId);
  try {
    await api.tabs.remove(tabId);
  } catch {
    // Schon zu, oder der Nutzer war schneller.
  }
}

export function registrierePopupWaechter(): void {
  const nav = api.webNavigation as typeof chrome.webNavigation | undefined;
  if (!nav || !nav.onCreatedNavigationTarget) return;

  /*
   * JEDEN Tab merken, den eine Seite aufmacht -- nicht nur die mit
   * `about:blank`. GEMESSEN am 08.09.2026 auf aniworld.to: Der Popunder ging
   * als UMLEITUNGSKETTE auf. Die erste Adresse war ein Zwischenhost, der in
   * keiner Liste steht; erst der Commit landete auf cruzswim.org -- einem
   * Host, den EasyList seit langem als `$popup` fuehrt. Wer nur die erste
   * Adresse prueft, sieht den Popunder nie und laesst ihn stehen.
   *
   * Der Merker bleibt zehn Sekunden: Eine Kette hat mehrere Glieder (302,
   * dann noch eine Umleitung per Skript), und jedes ist ein eigener Commit.
   */
  const merke = (tabId: number, quelle: number): void => {
    beobachtet.set(tabId, quelle);
    const frist = setTimeout(() => beobachtet.delete(tabId), 10_000) as unknown as { unref?: () => void };
    // Im Browser gibt `setTimeout` eine Zahl zurueck und `unref` gibt es
    // nicht; unter Node haelt der Timer sonst den Testlauf zehn Sekunden
    // offen. Deshalb optional, nicht bedingt auf die Umgebung.
    frist.unref?.();
  };

  nav.onCreatedNavigationTarget.addListener((d) => {
    merke(d.tabId, d.sourceTabId);
    void schliesse(d.tabId, d.sourceTabId, d.url);
  });

  nav.onCommitted.addListener((d) => {
    if (d.frameId !== 0) return;
    const quelle = beobachtet.get(d.tabId);
    if (quelle === undefined) return;
    void schliesse(d.tabId, quelle, d.url);
  });

  api.tabs.onRemoved.addListener((tabId) => beobachtet.delete(tabId));
}
