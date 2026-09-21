/**
 * Typisierte Lese- und Schreibhelfer ueber `storage.local` und
 * `storage.session`, dazu die Vorgaben und die Migration.
 *
 * Nie `storage.sync`: Was ein Konto ueber Geraete hinweg teilt, laeuft ueber
 * den Abgleich des Backends (Premium), nicht ueber den Browserhersteller.
 * Und nie eine besuchte URL: hier stehen Einstellungen, Ausnahmen je Host
 * und Token, sonst nichts (vertrag.md 8).
 */

import { api } from './browser.ts';
import { SPEICHER_VERSION } from './konstanten.ts';
import type { Einstellungen, SpeicherLokal, SpeicherSitzung } from './typen.ts';

export const EINSTELLUNGEN_VORGABE: Einstellungen = {
  aktiv: true,
  listen: {},
  sprache: null,
  thema: 'system',
  zaehlerBadge: true,
  warnung: true,
  cookieAntwort: 'aus',
  listenPflege: true,
  /*
   * AN ab Werk, seit dem 08.09.2026.
   *
   * Der Schalter stand auf AUS, ohne dass irgendwo ein Grund dafuer
   * aufgeschrieben war. Die Folge, GEMESSEN mit
   * `tests/laufzeit/fingerabdruck-diagnose.mjs`: Ein Kunde MIT Premium bekam
   * denselben Canvas-Hash wie ein Browser ganz ohne Erweiterung - und Cover
   * Your Tracks meldete ihm „nearly-unique fingerprint". Er zahlte fuer eine
   * Funktion, die stumm auslieferte.
   *
   * Ein `true` verschenkt hier nichts: `fingerabdruckFuer()` in
   * `hintergrund/kosmetik.ts` verlangt zusaetzlich eine wirksame
   * Premium-Lizenz. Fuer einen freien Nutzer aendert diese Zeile nichts.
   */
  fingerabdruck: true,
};

export const LOKAL_VORGABE: SpeicherLokal = {
  einstellungen: EINSTELLUNGEN_VORGABE,
  sites: {},
  konto: null,
  kontoHinweis: null,
  lizenz: null,
  eigeneRegeln: '',
  verbindungOffen: null,
  abgleich: { version: 0, aktualisiertAm: null },
  stand: { version: SPEICHER_VERSION },
  listenPflegeStand: null,
};

export const SITZUNG_VORGABE: SpeicherSitzung = {
  sitzung: null,
  listenFehler: null,
  verbindungFehler: null,
  fingerabdruckToken: null,
};

type Schluessel = keyof SpeicherLokal;

/**
 * Liest einen oder mehrere Schluessel; fehlende bekommen ihre Vorgabe.
 * `einstellungen` wird flach mit der Vorgabe gemischt, damit ein neues Feld
 * nach einem Update nicht `undefined` ist.
 */
export async function liesLokal<K extends Schluessel>(...schluessel: K[]): Promise<Pick<SpeicherLokal, K>> {
  const roh = (await api.storage.local.get(schluessel)) as Partial<SpeicherLokal>;
  const ergebnis = {} as Pick<SpeicherLokal, K>;
  for (const k of schluessel) {
    const wert = roh[k];
    (ergebnis as Record<string, unknown>)[k] =
      k === 'einstellungen'
        ? { ...EINSTELLUNGEN_VORGABE, ...((wert as Partial<Einstellungen> | undefined) ?? {}) }
        : (wert ?? LOKAL_VORGABE[k]);
  }
  return ergebnis;
}

export async function schreibeLokal(teil: Partial<SpeicherLokal>): Promise<void> {
  await api.storage.local.set(teil);
}

export async function liesSitzung<K extends keyof SpeicherSitzung>(
  ...schluessel: K[]
): Promise<Pick<SpeicherSitzung, K>> {
  // Safari kennt `storage.session` erst seit 16.4; ohne es gilt „nichts da".
  if (!api.storage.session) {
    const leer = {} as Pick<SpeicherSitzung, K>;
    for (const k of schluessel) (leer as Record<string, unknown>)[k] = SITZUNG_VORGABE[k];
    return leer;
  }
  const roh = (await api.storage.session.get(schluessel)) as Partial<SpeicherSitzung>;
  const ergebnis = {} as Pick<SpeicherSitzung, K>;
  for (const k of schluessel) (ergebnis as Record<string, unknown>)[k] = roh[k] ?? SITZUNG_VORGABE[k];
  return ergebnis;
}

export async function schreibeSitzung(teil: Partial<SpeicherSitzung>): Promise<void> {
  if (!api.storage.session) return;
  await api.storage.session.set(teil);
}

/**
 * Bringt einen aelteren Speicherstand auf die aktuelle Form.
 *
 * Version 0 heisst „nie geschrieben" (frische Installation): dann werden nur
 * die Vorgaben angelegt. Kuenftige Umzuege haengen sich als weitere
 * `if (version < n)`-Bloecke an; jeder Block hebt die Version um eins.
 */
export async function migriereSpeicher(): Promise<void> {
  // ROH lesen, nicht ueber liesLokal: das setzt fuer einen fehlenden
  // Schluessel die Vorgabe ein, und die Vorgabe fuer `stand` ist
  // `{ version: SPEICHER_VERSION }`. Ein frischer Speicher meldete damit die
  // aktuelle Version, der Umzugsblock wurde uebersprungen und `stand` nie
  // geschrieben. Beim naechsten Anheben von SPEICHER_VERSION haette das jede
  // ausgelieferte Installation uebersprungen.
  const roh = (await api.storage.local.get(['stand'])) as Partial<SpeicherLokal>;
  const stand = roh.stand;
  const version = typeof stand?.version === 'number' ? stand.version : 0;
  if (version >= SPEICHER_VERSION) return;

  const alles = (await api.storage.local.get(null)) as Partial<SpeicherLokal>;
  const neu: Partial<SpeicherLokal> = {};
  for (const k of Object.keys(LOKAL_VORGABE) as Schluessel[]) {
    if (alles[k] === undefined) (neu as Record<string, unknown>)[k] = LOKAL_VORGABE[k];
  }
  /*
   * Version 2: Niemand bleibt ausgeschaltet zurueck.
   *
   * Bis zum 07.09.2026 gab es in den Optionen den Schalter „AdSilence aktiv".
   * Er ist weg (Begruendung in `optionen/teile/Einstellungen.tsx`). Wer ihn
   * auf AUS stehen hatte, haette danach eine Erweiterung, die nichts blockt,
   * und keinen Schalter mehr, der sie zurueckholt - eine Sackgasse, die
   * niemand als solche erkennt: Es sieht aus, als sei AdSilence kaputt.
   *
   * Deshalb wird der Wert einmalig auf `true` gezogen. Das ist eine
   * Entscheidung ueber den Kopf des Nutzers hinweg, und sie ist die
   * mildere: Wer AdSilence wirklich nicht will, schaltet die Erweiterung in
   * `chrome://extensions` ab oder nimmt den Schalter im Popup fuer die eine
   * Seite. Beide Wege bleiben.
   */
  let einstellungen = { ...EINSTELLUNGEN_VORGABE, ...(alles.einstellungen ?? {}) };
  let geaendert = false;

  if (version < 2 && einstellungen.aktiv === false) {
    einstellungen = { ...einstellungen, aktiv: true };
    geaendert = true;
  }

  /*
   * Version 3: Wer Premium hat, soll es auch merken.
   *
   * `fingerabdruck` stand ab Werk auf AUS (Begruendung, warum das falsch war,
   * an der Vorgabe oben). Eine geaenderte Vorgabe erreicht aber nur NEUE
   * Installationen - in jedem vorhandenen Speicher steht weiter `false`, und
   * genau dort sitzt der zahlende Kunde, dem Cover Your Tracks „nearly-unique
   * fingerprint" meldet.
   *
   * Deshalb einmalig auf `true` ziehen. Das ist eine Entscheidung ueber den
   * Kopf des Nutzers hinweg, und sie trifft auch den, der den Schalter
   * BEWUSST ausgemacht hat. Anders als bei Version 2 ist das hier keine
   * Sackgasse: Der Schalter steht weiter in den Optionen und ist mit einem
   * Klick wieder aus. Der Fehler in die andere Richtung waere teurer - eine
   * bezahlte Funktion, die niemand je einschaltet, weil niemand weiss, dass
   * sie aus ist.
   */
  if (version < 3 && einstellungen.fingerabdruck === false) {
    einstellungen = { ...einstellungen, fingerabdruck: true };
    geaendert = true;
  }

  if (geaendert) neu.einstellungen = einstellungen;

  neu.stand = { version: SPEICHER_VERSION };
  await schreibeLokal(neu);
}
