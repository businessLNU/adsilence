/**
 * Der Verwechslungswarner im Hintergrund: bei jeder Navigation pruefen, ob
 * der Host wie eine bekannte Marke aussieht, es aber nicht ist.
 *
 * Die Erkennung selbst steht in `gemeinsam/phishing.ts` und ist eine reine
 * Funktion; hier steht nur, WANN sie laeuft und was danach passiert.
 *
 * ── Drei Bedingungen, alle drei muessen erfuellt sein ──────────────────────
 *   1. Die Erweiterung ist an.
 *   2. Der Nutzer hat den Warner eingeschaltet (`einstellungen.warnung`).
 *   3. Die Lizenz traegt Premium - geprueft ueber `lizenzWirksam`, also mit
 *      der Gnadenfrist, wie ueberall sonst.
 *
 * Fehlt eine, passiert gar nichts. Insbesondere wird die Markenliste dann
 * nicht einmal geladen.
 *
 * ── Was NICHT passiert ─────────────────────────────────────────────────────
 * Keine Anfrage nach draussen, kein Nachschlagen bei einem Dienst, keine
 * Liste besuchter Adressen. Der Host wird gegen eine Datei im Paket gehalten
 * und danach vergessen. Der Warnhinweis entsteht auf der Seite selbst.
 */

import { pruefeHost, type Marke, type Verdacht } from '../gemeinsam/phishing.ts';
import { fuellePlatzhalter } from '../oberflaeche/i18n-kern.ts';
import { hintergrundText } from './texte.ts';
import { liesLokal } from '../gemeinsam/speicher.ts';
import { siteErlaubt } from './ausnahmen.ts';
import { lizenzWirksam } from './lizenz-regeln.ts';
import { holePaketJson } from './regeln.ts';

/** Einmal geladen und behalten, solange der Worker lebt. */
let marken: Promise<Marke[]> | null = null;

function ladeMarken(): Promise<Marke[]> {
  if (!marken) {
    marken = holePaketJson<Marke[]>('phishing/marken.json').then((liste) =>
      Array.isArray(liste) ? liste.filter((m) => m && typeof m.name === 'string' && Array.isArray(m.domains)) : [],
    );
  }
  return marken;
}

/**
 * Wie sollen Cookie-Fenster beantwortet werden - oder gar nicht?
 *
 * Dieselben drei Bedingungen wie beim Warner: Erweiterung an, Einstellung
 * gesetzt, Lizenz traegt Premium. Auf einer Seite, die der Nutzer selbst
 * freigestellt hat, wird ebenfalls nicht geklickt: Dort will er die Seite so,
 * wie sie ist.
 */
export async function cookieAntwort(): Promise<'annehmen' | 'ablehnen' | null> {
  const { einstellungen, lizenz } = await liesLokal('einstellungen', 'lizenz');
  if (!einstellungen.aktiv) return null;
  if (einstellungen.cookieAntwort === 'aus') return null;
  if (!lizenzWirksam(lizenz, Date.now()).premium) return null;
  return einstellungen.cookieAntwort;
}

/** Darf der Warner ueberhaupt laufen? */
export async function warnerAktiv(): Promise<boolean> {
  const { einstellungen, lizenz } = await liesLokal('einstellungen', 'lizenz');
  if (!einstellungen.aktiv || !einstellungen.warnung) return false;
  return lizenzWirksam(lizenz, Date.now()).premium;
}

/**
 * Prueft einen Host und gibt den Verdacht zurueck, oder `null`.
 * Auch das Inhaltsskript fragt hierueber an, damit es die Markenliste nicht
 * selbst lesen muss (und damit sie nicht `web_accessible` sein muss).
 */
export async function verdachtFuer(host: string): Promise<Verdacht | null> {
  if (!host || !(await warnerAktiv())) return null;
  const { sites } = await liesLokal('sites');
  // Auf einer Seite, die der Nutzer selbst freigestellt hat, schweigt auch
  // der Warner: Er hat dort ausdruecklich seine Ruhe gewollt.
  if (siteErlaubt(sites, host)) return null;
  return pruefeHost(host, await ladeMarken());
}

/**
 * Die Antwort auf die Anfrage des Inhaltsskripts: Verdacht samt Texten, oder
 * beides `null`.
 *
 * Nur der Hauptrahmen fragt (`all_frames: false` im Manifest): Ein
 * Werbebanner in einem iframe, dessen Host zufaellig einer Marke aehnelt, ist
 * kein Grund, dem Nutzer eine Warnung ueber die ganze Seite zu legen - er ist
 * ja nicht dorthin gegangen.
 */
export async function warnungFuer(host: string): Promise<{ verdacht: Verdacht | null; texte: Awaited<ReturnType<typeof texteFuer>> | null }> {
  const verdacht = await verdachtFuer(host);
  if (!verdacht) return { verdacht: null, texte: null };
  return { verdacht, texte: await texteFuer(verdacht) };
}

/** Die sechs Saetze der Warnung, in der Sprache des Nutzers. */
async function texteFuer(verdacht: Verdacht) {
  const t = await hintergrundText();
  return {
    titel: t('warnung.titel'),
    satz: fuellePlatzhalter(t('warnung.satz'), { marke: verdacht.marke }),
    aufgerufen: t('warnung.aufgerufen'),
    echte: t('warnung.echte'),
    weg: t('warnung.weg'),
    bleiben: t('warnung.bleiben'),
  };
}

