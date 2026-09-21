#!/usr/bin/env node
/**
 * Erzeugt `_locales/<code>/messages.json` fuer JEDE Sprachdatei in `i18n/`.
 *
 * Nicht nur fuer `de` und `en`: Was hier fehlt, fehlt im Store. Der Browser
 * liest Name und Beschreibung eines Eintrags ausschliesslich aus `_locales`;
 * eine Sprache ohne Ordner faellt auf `default_locale` zurueck, und der Nutzer
 * sieht im Store einen englischen Namen neben einer uebersetzten Oberflaeche.
 *
 * Das Manifest darf nur `__MSG_extName__` und `__MSG_extDescription__` tragen;
 * alles andere uebersetzt die Oberflaeche selbst aus dem gebuendelten Katalog.
 * Deshalb landen hier NUR diese zwei Schluessel, und zwar in dem Format, das
 * der Browser fuer `default_locale` verlangt:
 *
 *     { "extName": { "message": "AdSilence" }, ... }
 *
 * Aufruf: `node scripts/locales.mjs [--ziel=<ordner>]`
 * Ohne `--ziel` nach `extension/_locales/`; das Bauskript (B1) kopiert von
 * dort nach `dist/<ziel>/_locales/`.
 *
 * Fehlt in einer Sprache einer der zwei Schluessel, bricht das Skript ab und
 * schreibt die Datei NICHT: Ein Store-Eintrag mit leerem Namen ist schlimmer
 * als ein fehlender, und eine halb geschriebene `messages.json` haette den
 * Abbruch ueberlebt und beim naechsten Bauen wie ein gueltiges Ergebnis
 * ausgesehen.
 *
 * Ordner ohne Katalog werden entfernt. `_locales` ist ein Bauergebnis, kein
 * Ablagefach: Wer eine Sprache aus `i18n/` nimmt, bekaeme sonst einen
 * Store-Eintrag in einer Sprache, die die Oberflaeche nicht mehr kennt.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = dirname(dirname(fileURLToPath(import.meta.url)));
const quelle = join(wurzel, 'i18n');

const zielArg = process.argv.find((a) => a.startsWith('--ziel='));
const ziel = zielArg ? zielArg.slice('--ziel='.length) : join(wurzel, '_locales');

const PFLICHT = ['extName', 'extDescription'];

const dateien = readdirSync(quelle)
  .filter((d) => d.endsWith('.json'))
  .sort();

if (dateien.length === 0) {
  console.error(`locales: keine Sprachdateien in ${quelle}`);
  process.exit(1);
}

let fehler = 0;
const geschrieben = [];

for (const datei of dateien) {
  const code = datei.slice(0, -'.json'.length);

  let katalog;
  try {
    katalog = JSON.parse(readFileSync(join(quelle, datei), 'utf8'));
  } catch (e) {
    console.error(`locales: ${datei} ist kein gueltiges JSON: ${e.message}`);
    fehler += 1;
    continue;
  }

  const nachrichten = {};
  let vollstaendig = true;
  for (const schluessel of PFLICHT) {
    const wert = katalog[schluessel];
    if (typeof wert !== 'string' || wert.trim() === '') {
      console.error(`locales: ${datei} hat keinen Wert fuer "${schluessel}"`);
      fehler += 1;
      vollstaendig = false;
      continue;
    }
    nachrichten[schluessel] = { message: wert };
  }
  if (!vollstaendig) continue;

  // Chrome will Ordnernamen wie `en`, `de`, `pt_BR`; ein Bindestrich waere
  // dort falsch. Die Kataloge heissen nach ISO-639-1, also nur zwei Buchstaben.
  const ordnerName = code.replace('-', '_');
  const ordner = join(ziel, ordnerName);
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, 'messages.json'), JSON.stringify(nachrichten, null, 2) + '\n');
  geschrieben.push(ordnerName);
}

// Verwaiste Ordner raeumen: alles, was kein Katalog mehr traegt.
const behalten = new Set(geschrieben);
let entfernt = 0;
if (existsSync(ziel)) {
  for (const eintrag of readdirSync(ziel, { withFileTypes: true })) {
    if (!eintrag.isDirectory() || behalten.has(eintrag.name)) continue;
    rmSync(join(ziel, eintrag.name), { recursive: true, force: true });
    entfernt += 1;
  }
}

if (fehler > 0) process.exit(1);
console.log(
  `locales: ${geschrieben.length} Sprachen nach ${ziel} geschrieben (${geschrieben.join(', ')})` +
    (entfernt > 0 ? `, ${entfernt} verwaiste Ordner entfernt` : ''),
);
