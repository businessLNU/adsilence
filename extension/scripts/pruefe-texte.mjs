#!/usr/bin/env node
/**
 * Waechter fuer die Texte der Erweiterung. Drei Pruefungen, alle mechanisch:
 *
 * 1. Jede `i18n/<code>.json` hat GENAU die Schluessel von `de.json`, kein
 *    Wert ist leer, und die Platzhalter `{name}` sind je Schluessel dieselben.
 *    `de.json` ist der Vertrag, wie im Backend `de.ts`.
 * 2. Kein Schluessel enthaelt etwas ausser `[a-zA-Z0-9._]`.
 * 3. In `src/popup`, `src/optionen`, `src/oberflaeche` steht kein fester
 *    Nutzertext im JSX: kein `>Wort Wort<` mit Buchstaben, keine festen
 *    `aria-label`-, `placeholder`- oder `title`-Werte. Ein Text, den ein
 *    Mensch liest, laeuft ueber `t()` - ohne Ausnahme.
 * 4. Kein Gedankenstrich und kein Emoji in den Texten.
 *
 * Aufruf: `node scripts/pruefe-texte.mjs`. Beendet mit 1 bei jedem Fund.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = dirname(dirname(fileURLToPath(import.meta.url)));
const funde = [];

// ── 1 + 2 + 4: Kataloge ────────────────────────────────────────────────────

const katalogOrdner = join(wurzel, 'i18n');
const katalogDateien = readdirSync(katalogOrdner)
  .filter((d) => d.endsWith('.json'))
  .sort();

function platzhalter(text) {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

const VERBOTEN_IM_TEXT = /[–—]|\p{Extended_Pictographic}/u;

const vertrag = JSON.parse(readFileSync(join(katalogOrdner, 'de.json'), 'utf8'));
const vertragSchluessel = Object.keys(vertrag);

for (const schluessel of vertragSchluessel) {
  if (!/^[a-zA-Z0-9._]+$/.test(schluessel)) {
    funde.push(`i18n/de.json: Schluessel "${schluessel}" enthaelt unerlaubte Zeichen`);
  }
}

for (const datei of katalogDateien) {
  const katalog = JSON.parse(readFileSync(join(katalogOrdner, datei), 'utf8'));
  const eigene = new Set(Object.keys(katalog));

  for (const schluessel of vertragSchluessel) {
    if (!eigene.has(schluessel)) {
      funde.push(`i18n/${datei}: fehlt "${schluessel}"`);
      continue;
    }
    const wert = katalog[schluessel];
    if (typeof wert !== 'string' || wert.trim() === '') {
      funde.push(`i18n/${datei}: "${schluessel}" ist leer`);
      continue;
    }
    const soll = platzhalter(vertrag[schluessel]).join(',');
    const ist = platzhalter(wert).join(',');
    if (soll !== ist) {
      funde.push(`i18n/${datei}: "${schluessel}" hat Platzhalter {${ist}}, de.json hat {${soll}}`);
    }
    if (VERBOTEN_IM_TEXT.test(wert)) {
      funde.push(`i18n/${datei}: "${schluessel}" enthaelt Gedankenstrich oder Emoji`);
    }
  }
  for (const schluessel of eigene) {
    if (!(schluessel in vertrag)) {
      funde.push(`i18n/${datei}: "${schluessel}" gibt es in de.json nicht`);
    }
  }
}

// ── 3: feste Texte im JSX ──────────────────────────────────────────────────

function alleDateien(ordner) {
  const raus = [];
  for (const eintrag of readdirSync(ordner)) {
    const pfad = join(ordner, eintrag);
    if (statSync(pfad).isDirectory()) raus.push(...alleDateien(pfad));
    else if (/\.(tsx|ts|html)$/.test(eintrag)) raus.push(pfad);
  }
  return raus;
}

const ORDNER = ['src/popup', 'src/optionen', 'src/oberflaeche'];

/**
 * `>Wort Wort<`: zwischen zwei Tags stehen mindestens zwei Woerter mit
 * Buchstaben. Einzelne Zeichen wie `>{n}<` oder `>-<` sind erlaubt: Das sind
 * Werte, keine Saetze. Ein einzelnes Wort meldet der zweite Ausdruck, sobald
 * es einen Umlaut oder mehr als drei Buchstaben hat - `>AdSilence<` ist der
 * Produktname und darf.
 */
// Kein `=` oder `-` vor dem `>` (Pfeilfunktionen, Kommentare), und im Text
// keine Zeichen, die nur Code hat: `( ) ; = & | ?`. Ein Satz fuer Menschen
// kommt ohne sie aus; ein Vergleich `a > b && c < d` nicht.
const SATZ_IM_JSX = /(?<![=\-])>\s*[A-Za-zÄÖÜäöüß][^<>{}();=&|?]*\s[A-Za-zÄÖÜäöüß][^<>{}();=&|?]*</g;
const WORT_IM_JSX = /(?<![=\-])>\s*([A-Za-zÄÖÜäöüß]{4,})\s*</g;
const ATTRIBUT_FEST = /\b(aria-label|placeholder|title|alt)\s*=\s*"[^"]*[A-Za-zÄÖÜäöüß]{2,}[^"]*"/g;
const ERLAUBTE_WOERTER = new Set(['AdSilence']);

for (const ordner of ORDNER) {
  const voll = join(wurzel, ordner);
  let dateien;
  try {
    dateien = alleDateien(voll);
  } catch {
    continue;
  }
  for (const datei of dateien) {
    const text = readFileSync(datei, 'utf8');
    const rel = relative(wurzel, datei);

    // Kommentare tragen deutsche Saetze und duerfen das. Sie werden vor der
    // Suche entfernt, damit ein Begruendungskommentar keinen Fund erzeugt.
    const ohneKommentare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const m of ohneKommentare.matchAll(SATZ_IM_JSX)) {
      const inhalt = m[0].slice(1, -1).trim();
      if (datei.endsWith('.html') && /<title>/.test(text) && inhalt.length === 0) continue;
      funde.push(`${rel}: fester Text im JSX: "${inhalt}"`);
    }
    for (const m of ohneKommentare.matchAll(WORT_IM_JSX)) {
      if (ERLAUBTE_WOERTER.has(m[1])) continue;
      funde.push(`${rel}: festes Wort im JSX: "${m[1]}"`);
    }
    for (const m of ohneKommentare.matchAll(ATTRIBUT_FEST)) {
      funde.push(`${rel}: fester Text in Attribut: ${m[0]}`);
    }
    if (/[–—]/.test(ohneKommentare)) {
      funde.push(`${rel}: enthaelt einen Gedankenstrich`);
    }
  }
}

if (funde.length > 0) {
  console.error(`pruefe-texte: ${funde.length} Funde`);
  for (const f of funde) console.error('  ' + f);
  process.exit(1);
}
console.log(
  `pruefe-texte: ${katalogDateien.length} Sprachen, ${vertragSchluessel.length} Schluessel, keine festen Texte`,
);
