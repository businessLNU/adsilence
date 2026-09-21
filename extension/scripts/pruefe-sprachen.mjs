#!/usr/bin/env node
/**
 * Waechter fuer die 20 Sprachkataloge in `i18n/`.
 *
 * `pruefe-texte.mjs` prueft, ob die Kataloge zueinander passen (Schluessel,
 * Platzhalter, keine festen Texte im JSX). Dieses Skript prueft, ob in ihnen
 * wirklich UEBERSETZUNGEN stehen und ob sie in die Oberflaeche passen. Beides
 * faellt bei einer reinen Schluesselpruefung nicht auf: Eine Datei, in der
 * jeder zweite Wert noch deutsch ist, hat trotzdem alle Schluessel.
 *
 * Sechs Pruefungen, alle mechanisch:
 *
 *   1. Gueltiges JSON, und GENAU die Schluesselmenge von `de.json`
 *      (fehlende und ueberzaehlige werden einzeln genannt).
 *   2. Je Schluessel dieselbe Menge an `{platzhaltern}` wie in `de.json`.
 *      Ein verlorener Platzhalter heisst: Der Satz zeigt die Zahl nie an.
 *   3. Kein leerer Wert. Ein leerer Wert ist im Fenster eine Luecke.
 *   4. Kein Wert laenger als 20 Zeichen ist Zeichen fuer Zeichen der deutsche.
 *      Kurze Werte duerfen zusammenfallen ("Premium", "Browser", "OK");
 *      ein langer Satz, der wortgleich deutsch ist, ist keine Uebersetzung,
 *      sondern eine vergessene Zeile.
 *   5. "AdSilence" steht unveraendert in `extName`. Der Produktname wird
 *      nicht uebersetzt und nicht transkribiert - er ist der Store-Eintrag.
 *   6. Knopftexte (Schluessel auf `.knopf` oder unter `gemeinsam.`) sind
 *      hoechstens doppelt so lang wie der deutsche Wert. Ein Knopf hat eine
 *      feste Breite; was doppelt so lang ist, bricht um oder wird abgeschnitten.
 *      Gemessen in Codepoints, nicht in UTF-16-Einheiten: Ein Devanagari-Zeichen
 *      ist ein Zeichen, auch wenn `"…".length` es anders sieht.
 *
 * Zwei Einschraenkungen an 6, beide begruendet:
 *
 * Ein BODEN von 12 Zeichen. Bei "An" (2 Zeichen) waere "doppelt so lang" 4 -
 * darunter bleiben Sprachen wie Arabisch oder Thai gar nicht, weil dort schon
 * das kuerzeste richtige Wort laenger ist. Ohne Boden meldete die Pruefung
 * genau die Faelle, an denen niemand etwas aendern kann.
 *
 * Und SATZTEILE zaehlen nicht als Knopf. Ein Wert, dessen letztes Namensstueck
 * als `{platzhalter}` im Wert eines Geschwisterschluessels steht, wird in einen
 * Satz eingesetzt, statt auf einem Knopf zu stehen: `gemeinsam.zustimmung.agb`
 * landet ueber `TextMitTeilen` als `<a>` mitten in `…zustimmung.satz`, laeuft
 * dort im Fliesstext um und hat keine feste Breite - `white-space: nowrap`
 * steht in `basis.css` am Knopf, nicht an `.klein`. Ohne diese Ausnahme meldete
 * die Pruefung zehnmal denselben Nicht-Fehler: "AGB" ist eine dreibuchstabige
 * deutsche Abkuerzung, und "Условия использования" oder "algemene voorwaarden"
 * lassen sich nicht auf 12 Zeichen kuerzen, ohne falsch zu werden. Der Deckel
 * darf keinen Anreiz erzeugen, einen Pflichtlink unleserlich abzukuerzen.
 * Hergeleitet statt aufgezaehlt: Eine Liste von Hand veraltet mit dem ersten
 * neuen Satz, der einen Platzhalter bekommt.
 *
 * Aufruf: `node scripts/pruefe-sprachen.mjs` (auch `npm run pruefe:sprachen`).
 * Beendet mit 1 bei jedem Fund.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = dirname(dirname(fileURLToPath(import.meta.url)));
const ordner = join(wurzel, 'i18n');

/**
 * Die Sprachen, die es gibt — aus dem Ordner, nicht aus einer Aufzaehlung.
 *
 * Hier stand eine Liste mit zwanzig Codes. Beim Angleichen an die Website am
 * 07.09.2026 fielen zehn Kataloge weg, und dieser Pruefer meldete daraufhin
 * zehnmal „die Sprache fehlt ganz" — fuer Dateien, die absichtlich weg sind.
 * Eine abgeschriebene Liste stimmt bis zur naechsten Aenderung; danach meldet
 * sie Fehler, die keine sind, und man gewoehnt sich an rote Zeilen.
 *
 * Der Ordner kann nicht veralten: Was dort liegt, ist da. Ob es zur WEBSITE
 * passt, prueft `tests/rechenregeln/64-…` im Hauptprojekt — dort, wo beide
 * Seiten sichtbar sind.
 */
const ERWARTET = readdirSync(ordner)
  .filter((d) => d.endsWith('.json'))
  .map((d) => d.replace(/\.json$/, ''))
  .sort();

/** Werte, die in jeder Sprache gleich heissen duerfen (Pruefung 4). */
const GLEICH_ERLAUBT = new Set(['AdSilence', 'Premium']);

/** Boden fuer Pruefung 6, siehe Kopf. */
const KNOPF_BODEN = 12;

const funde = [];
const proDatei = new Map();

function fund(datei, text) {
  funde.push(`i18n/${datei}: ${text}`);
  proDatei.set(datei, (proDatei.get(datei) ?? 0) + 1);
}

function zeichen(text) {
  return [...text].length;
}

function platzhalter(text) {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

function hatBuchstaben(text) {
  return /\p{Letter}/u.test(text);
}

function istKnopf(schluessel) {
  return schluessel.endsWith('.knopf') || schluessel.startsWith('gemeinsam.');
}

/**
 * Steht das letzte Namensstueck von `schluessel` als `{platzhalter}` im
 * deutschen Wert eines GESCHWISTERschluessels? Dann ist der Wert ein Satzteil.
 * Nur Geschwister, damit `optionen.konto.email` nicht deshalb als Satzteil
 * gilt, weil `popup.premium.verbundenAls` ein `{email}` traegt - und der
 * Schluessel selbst zaehlt nicht mit, sonst waere `gemeinsam.fehler.code`
 * ("Fehlercode {code}") sein eigener Satz.
 */
function istSatzteil(schluessel, vertrag) {
  const punkt = schluessel.lastIndexOf('.');
  if (punkt < 0) return false;
  const elter = schluessel.slice(0, punkt + 1);
  const blatt = schluessel.slice(punkt + 1);
  for (const [anderer, wert] of Object.entries(vertrag)) {
    if (anderer === schluessel || !anderer.startsWith(elter)) continue;
    if (typeof wert === 'string' && platzhalter(wert).includes(blatt)) return true;
  }
  return false;
}

// ── Dateien einsammeln ─────────────────────────────────────────────────────

const vorhanden = readdirSync(ordner)
  .filter((d) => d.endsWith('.json'))
  .map((d) => d.slice(0, -'.json'.length))
  .sort();

for (const code of ERWARTET) {
  if (!vorhanden.includes(code)) funde.push(`i18n/: die Sprache "${code}" fehlt ganz`);
}
for (const code of vorhanden) {
  if (!ERWARTET.includes(code)) funde.push(`i18n/${code}.json: nicht in der Liste der 20 Sprachen`);
}

// ── Vertrag lesen ──────────────────────────────────────────────────────────

const vertrag = JSON.parse(readFileSync(join(ordner, 'de.json'), 'utf8'));
const vertragSchluessel = Object.keys(vertrag);
const satzteile = new Set(vertragSchluessel.filter((s) => istSatzteil(s, vertrag)));

// ── Die sechs Pruefungen ───────────────────────────────────────────────────

const kataloge = new Map();

for (const code of vorhanden) {
  const datei = `${code}.json`;
  let katalog;
  try {
    katalog = JSON.parse(readFileSync(join(ordner, datei), 'utf8'));
  } catch (fehler) {
    fund(datei, `kein gueltiges JSON: ${fehler.message}`);
    continue;
  }
  if (katalog === null || typeof katalog !== 'object' || Array.isArray(katalog)) {
    fund(datei, 'die Datei enthaelt kein Objekt');
    continue;
  }
  kataloge.set(code, katalog);

  const eigene = Object.keys(katalog);
  const eigeneMenge = new Set(eigene);

  // 1: Schluesselmenge
  for (const schluessel of vertragSchluessel) {
    if (!eigeneMenge.has(schluessel)) fund(datei, `fehlender Schluessel "${schluessel}"`);
  }
  for (const schluessel of eigene) {
    if (!(schluessel in vertrag)) fund(datei, `ueberzaehliger Schluessel "${schluessel}"`);
  }

  for (const schluessel of vertragSchluessel) {
    if (!eigeneMenge.has(schluessel)) continue;
    const wert = katalog[schluessel];
    const deutsch = vertrag[schluessel];

    if (typeof wert !== 'string') {
      fund(datei, `"${schluessel}" ist kein Text (${typeof wert})`);
      continue;
    }

    // 3: leer
    if (wert.trim() === '') {
      fund(datei, `"${schluessel}" ist leer`);
      continue;
    }

    // 2: Platzhalter
    const soll = platzhalter(deutsch);
    const ist = platzhalter(wert);
    if (soll.join(',') !== ist.join(',')) {
      const fehlt = soll.filter((p) => !ist.includes(p));
      const zuviel = ist.filter((p) => !soll.includes(p));
      const teile = [];
      if (fehlt.length) teile.push(`fehlt {${fehlt.join('} {')}}`);
      if (zuviel.length) teile.push(`ueberzaehlig {${zuviel.join('} {')}}`);
      fund(datei, `"${schluessel}": Platzhalter ${teile.join(', ')}`);
    }

    // 4: unuebersetzt stehengeblieben
    if (
      code !== 'de' &&
      wert === deutsch &&
      zeichen(wert) > 20 &&
      !GLEICH_ERLAUBT.has(wert.trim()) &&
      hatBuchstaben(wert)
    ) {
      fund(datei, `"${schluessel}" ist wortgleich deutsch: "${wert.slice(0, 60)}"`);
    }

    // 6: Knopfbreite
    if (istKnopf(schluessel) && !satzteile.has(schluessel)) {
      const deckel = Math.max(zeichen(deutsch) * 2, KNOPF_BODEN);
      if (zeichen(wert) > deckel) {
        fund(
          datei,
          `"${schluessel}" ist ${zeichen(wert)} Zeichen lang, erlaubt sind ${deckel} ` +
            `(deutsch: ${zeichen(deutsch)}): "${wert}"`,
        );
      }
    }
  }

  // 5: Produktname
  const name = katalog.extName;
  if (typeof name !== 'string' || !name.includes('AdSilence')) {
    fund(datei, `extName enthaelt "AdSilence" nicht: "${name ?? ''}"`);
  }
}

// ── Ausgabe ────────────────────────────────────────────────────────────────

if (funde.length > 0) {
  console.error(`pruefe-sprachen: ${funde.length} Funde`);
  for (const f of funde) console.error('  ' + f);
  console.error('');
  for (const [datei, anzahl] of [...proDatei].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${datei}: ${anzahl}`);
  }
  process.exit(1);
}

console.log(
  `pruefe-sprachen: ${vorhanden.length} Sprachen, ${vertragSchluessel.length} Schluessel, keine Funde`,
);
