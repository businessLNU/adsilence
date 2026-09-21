/**
 * Der Zaehler auf dem Symbol. Chromium fuehrt ihn selbst
 * (`displayActionCountAsBadgeText`), ohne dass die Erweiterung eine einzige
 * Anfrage sieht; deshalb braucht es kein `declarativeNetRequestFeedback`.
 * Browser ohne diese Option zeigen keinen Zaehler, und das Popup sagt das.
 */

import { api } from '../gemeinsam/browser.ts';
import { holePaketJson } from './regeln.ts';
import { BADGE_FARBE, SAMMELREGEL } from '../gemeinsam/konstanten.ts';
import { liesLokal } from '../gemeinsam/speicher.ts';

type Dnr = typeof chrome.declarativeNetRequest & {
  setExtensionActionOptions?: (o: { displayActionCountAsBadgeText?: boolean }) => Promise<void>;
};

export async function badgeAktualisieren(): Promise<void> {
  const { einstellungen } = await liesLokal('einstellungen');
  const an = einstellungen.aktiv && einstellungen.zaehlerBadge;

  const dnr = api.declarativeNetRequest as Dnr | undefined;
  if (dnr && typeof dnr.setExtensionActionOptions === 'function') {
    try {
      await dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: an });
    } catch {
      // Firefox kennt die Option nicht in jeder Version.
    }
  }
  const action = api.action as typeof chrome.action | undefined;
  if (!action) return;
  try {
    await action.setBadgeBackgroundColor({ color: BADGE_FARBE });
    if (!an) await action.setBadgeText({ text: '' });
  } catch {
    // Safari ohne Badge-Farbe: egal.
  }
}

/**
 * Was Chrome zurueckgibt, solange es den Zaehler SELBST auf das Symbol
 * schreibt (`displayActionCountAsBadgeText`). Kein Text, sondern eine
 * Anweisung an die Zeichenschicht; die Zahl entsteht erst dort.
 */
const PLATZHALTER = '<<declarativeNetRequestActionCount>>';

/**
 * Der Zaehler dieses Tabs.
 *
 *   Zahl        so viele Anfragen, selbst gesetzt
 *   'amSymbol'  Chrome zaehlt und zeigt es am Symbol, gibt die Zahl aber
 *               nicht heraus
 *   null        es gibt keinen Zaehler
 *
 * ── Warum die mittlere Lage noetig ist ─────────────────────────────────────
 * GEMESSEN am 03.09.2026 in Chrome for Testing 140, an einer Seite mit
 * blockierten Anfragen: `getBadgeText({tabId})` liefert woertlich
 * `<<declarativeNetRequestActionCount>>`, nicht `"26"`. `parseInt` darauf
 * ergibt NaN, die alte Fassung gab deshalb `null` zurueck - und das Popup
 * schrieb „Zaehler in diesem Browser nicht verfuegbar", waehrend die Zahl 26
 * gut sichtbar auf dem Symbol darueber stand. Die Auskunft war also nicht nur
 * unvollstaendig, sie war falsch.
 *
 * Die Zahl LAESST sich nicht beschaffen: `getMatchedRules` verlangt
 * `declarativeNetRequestFeedback`, und diese Berechtigung gaebe der
 * Erweiterung Zugriff auf die getroffenen Regeln je Tab, also auf den Verlauf.
 * Das widerspricht Regel 2 des Katalogeintrags und dem, was im Store steht.
 * Lieber keine Zahl im Popup als eine Berechtigung, die wir nicht brauchen.
 */
export async function vomBadge(tabId: number): Promise<number | 'amSymbol' | null> {
  const action = api.action as typeof chrome.action | undefined;
  if (!action || typeof action.getBadgeText !== 'function') return null;
  try {
    const text = await action.getBadgeText({ tabId });
    if (text === PLATZHALTER) return 'amSymbol';
    const zahl = parseInt(text, 10);
    return Number.isFinite(zahl) ? zahl : null;
  } catch {
    return null;
  }
}

/** Was in diesem Tab griff, aufgeschluesselt nach Liste und Regel. */
export type Treffer = {
  gesamt: number;
  jeListe: { id: string; anzahl: number; regeln: { was: string; anzahl: number }[] }[];
};

/**
 * Der lesbare Kern einer Regelbedingung: die Domain, die sie trifft.
 *
 * Chrome gibt zu einem Treffer NUR Regelnummer und Liste heraus, nie die
 * aufgerufene Adresse. Die Regel selbst liegt aber im Paket, und aus ihrem
 * Muster laesst sich ablesen, WEN sie sperrt - `||doubleclick.net^` wird zu
 * `doubleclick.net`. Das ist die Auskunft, die der Nutzer sucht, und sie
 * entsteht ohne einen einzigen Blick auf seinen Verlauf: Sie steht seit dem
 * Bauen im Paket und waere dieselbe, haette er die Seite nie geoeffnet.
 *
 * Deckt eine Regel eine ganze LISTE von Domains ab, gibt es diesen Kern
 * nicht - dann kommt `SAMMELREGEL` zurueck, und das Popup schreibt hin, dass
 * es eine von mehreren war. Exportiert fuer `tests/hintergrund/badge.test.ts`.
 */
export function lesbaresMuster(bedingung: { urlFilter?: string; regexFilter?: string; requestDomains?: string[] }): string {
  const domains = bedingung.requestDomains;
  // GENAU eine Domain: dann steht fest, wen die Regel getroffen hat.
  if (domains && domains.length === 1) return domains[0]!;

  const muster = bedingung.urlFilter ?? bedingung.regexFilter ?? '';
  if (muster) {
    // `||host^pfad` auf den Host eindampfen; sonst das Muster roh, aber kurz.
    const host = /^\|\|([A-Za-z0-9._*-]+)/.exec(muster);
    if (host) return host[1]!.replace(/\.$/, '');
    return muster.length > 40 ? `${muster.slice(0, 40)}…` : muster;
  }

  // Eine Regel ueber viele Domains und kein Muster: siehe `SAMMELREGEL`.
  if (domains && domains.length > 1) return SAMMELREGEL;
  return '?';
}

/** Regeln einer Liste, einmal geladen und dann behalten. */
const regelMerker = new Map<string, Promise<Map<number, string>>>();

function regelnDerListe(listenId: string): Promise<Map<number, string>> {
  let merker = regelMerker.get(listenId);
  if (!merker) {
    merker = (async () => {
      const karte = new Map<number, string>();
      const regeln = await holePaketJson<{ id: number; condition: Record<string, never> }[]>(`rules/${listenId}.json`);
      if (!Array.isArray(regeln)) return karte;
      for (const regel of regeln) karte.set(regel.id, lesbaresMuster(regel.condition));
      return karte;
    })();
    regelMerker.set(listenId, merker);
  }
  return merker;
}

/**
 * Die genauen Treffer dieses Tabs, oder `null`, wenn der Browser sie nicht
 * herausgibt.
 *
 * ── Warum das ueberhaupt geht, ohne den Verlauf zu sehen ───────────────────
 * `getMatchedRules` verlangt `declarativeNetRequestFeedback` ODER
 * `activeTab` fuer genau diesen Tab. Die erste Berechtigung ist dauerhaft und
 * gilt fuer jeden Tab - Chrome nennt sie dem Nutzer als „Browserverlauf
 * lesen", und das waere bei einer Erweiterung, die mit „keine Telemetrie"
 * antritt, das falsche Versprechen. `activeTab` gilt nur fuer den Tab, in dem
 * der Nutzer GERADE das Symbol angeklickt hat, und nur bis er ihn verlaesst.
 * Genau der Moment, in dem das Popup aufgeht.
 *
 * Was zurueckkommt, sind Regelnummer und Listenkennung - KEINE Adressen.
 * Auch deshalb ist die Aufschluesselung nach Liste alles, was das Popup
 * zeigen kann, und mehr braucht es nicht.
 *
 * GEMESSEN am 03.09.2026: Ohne Klick auf das Symbol antwortet der Aufruf mit
 * „must have the declarativeNetRequestFeedback permission or have activeTab
 * granted". Das ist kein Fehler, sondern der Normalfall - deshalb `null` und
 * der Rueckfall auf den Badge.
 */
export async function trefferImTab(tabId: number): Promise<Treffer | null> {
  const dnr = api.declarativeNetRequest as typeof chrome.declarativeNetRequest | undefined;
  if (!dnr || typeof dnr.getMatchedRules !== 'function') return null;
  try {
    const { rulesMatchedInfo } = await dnr.getMatchedRules({ tabId });

    // Je Liste zaehlen, und darin je Regelnummer.
    const jeListe = new Map<string, Map<number, number>>();
    for (const treffer of rulesMatchedInfo) {
      const liste = treffer.rule.rulesetId;
      const regeln = jeListe.get(liste) ?? new Map<number, number>();
      regeln.set(treffer.rule.ruleId, (regeln.get(treffer.rule.ruleId) ?? 0) + 1);
      jeListe.set(liste, regeln);
    }

    const ergebnis = [];
    for (const [listenId, regeln] of jeListe) {
      const namen = await regelnDerListe(listenId);
      const zusammen = new Map<string, number>();
      for (const [regelId, anzahl] of regeln) {
        const was = namen.get(regelId) ?? `#${regelId}`;
        zusammen.set(was, (zusammen.get(was) ?? 0) + anzahl);
      }
      ergebnis.push({
        id: listenId,
        anzahl: [...regeln.values()].reduce((a, b) => a + b, 0),
        regeln: [...zusammen].map(([was, anzahl]) => ({ was, anzahl })).sort((a, b) => b.anzahl - a.anzahl),
      });
    }
    ergebnis.sort((a, b) => b.anzahl - a.anzahl);
    return { gesamt: rulesMatchedInfo.length, jeListe: ergebnis };
  } catch {
    // Kein Recht auf diesen Tab: der Normalfall ausserhalb eines Klicks.
    return null;
  }
}
