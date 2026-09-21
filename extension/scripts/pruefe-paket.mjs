#!/usr/bin/env node
/**
 * Ein GEBAUTES Paket gegen sein eigenes Manifest halten.
 *
 *   node scripts/pruefe-paket.mjs [--ziel=chromium|firefox|safari|alle] [--aus=dist]
 *
 * Warum das nicht der Typecheck erledigt: Zwischen Quelltext und Paket liegen
 * drei Schritte, die Dateien VERSCHIEBEN und UMBENENNEN (esbuild, Vite,
 * Kopieren). Ein Manifest, das auf `popup/index.html` zeigt, waehrend Vite die
 * Datei nach `seiten/popup.html` legt, ist typkorrekt und trotzdem kaputt.
 * Der Browser sagt dazu je nach Eintrag gar nichts: Ein fehlendes
 * `default_popup` gibt beim Klick ein leeres Fenster, ein fehlendes Symbol
 * einen grauen Kasten, ein fehlendes `_locales/<default_locale>` einen
 * Erweiterungsnamen, der woertlich `__MSG_extName__` lautet.
 *
 * `tests/hintergrund/manifest.test.ts` prueft dieselben Pfade VOR dem Bau
 * gegen die Quellen. Dieses Skript prueft sie DANACH gegen die echten Dateien;
 * beides zusammen deckt die Strecke ab.
 *
 * Rueckgabe 0, wenn jedes Ziel sauber ist, sonst 1.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const ZIELE = ['chromium', 'firefox', 'safari'];

function argument(name, vorgabe) {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : vorgabe;
}

const zielArg = argument('ziel', 'alle');
const ausWurzel = argument('aus', join(WURZEL, 'dist'));
const ziele = zielArg === 'alle' ? ZIELE : [zielArg];

/** Sammelt Pfade mit einer Beschriftung, damit der Fehler sagt, WOHER er kommt. */
function sammlePfade(m) {
  const pfade = [];
  const nimm = (wo, wert) => {
    if (typeof wert === 'string' && wert.length > 0) pfade.push({ wo, pfad: wert });
  };

  for (const [groesse, pfad] of Object.entries(m.icons ?? {})) nimm(`icons.${groesse}`, pfad);
  for (const [groesse, pfad] of Object.entries(m.action?.default_icon ?? {})) nimm(`action.default_icon.${groesse}`, pfad);
  nimm('action.default_popup', m.action?.default_popup);
  nimm('options_ui.page', m.options_ui?.page);
  nimm('background.service_worker', m.background?.service_worker);
  (m.background?.scripts ?? []).forEach((p, i) => nimm(`background.scripts[${i}]`, p));

  (m.content_scripts ?? []).forEach((s, i) => {
    (s.js ?? []).forEach((p, j) => nimm(`content_scripts[${i}].js[${j}]`, p));
    (s.css ?? []).forEach((p, j) => nimm(`content_scripts[${i}].css[${j}]`, p));
  });

  (m.declarative_net_request?.rule_resources ?? []).forEach((r) => nimm(`rule_resources.${r.id}`, r.path));
  (m.web_accessible_resources ?? []).forEach((w, i) => {
    (w.resources ?? []).forEach((p, j) => {
      // Muster wie `kosmetik/*.css` lassen sich nicht als Datei pruefen; hier
      // zaehlt, dass der Ordner ueberhaupt existiert.
      if (p.includes('*')) nimm(`web_accessible_resources[${i}][${j}] (Ordner)`, p.split('*')[0].replace(/\/$/, ''));
      else nimm(`web_accessible_resources[${i}][${j}]`, p);
    });
  });

  if (m.default_locale) nimm('default_locale', `_locales/${m.default_locale}/messages.json`);
  return pfade;
}

/** Was ein Inhaltsskript per fetch aus dem Paket liest, braucht eine Freigabe. */
function freigabenPruefen(m, fehler) {
  const gelesen = [];
  const ordner = join(WURZEL, 'src', 'inhalt');
  if (existsSync(ordner)) {
    const muster = /fetch\(\s*api\.runtime\.getURL\(\s*[`'"]([^`'"]*)[`'"]/g;
    for (const name of readdirSync(ordner)) {
      if (!name.endsWith('.ts')) continue;
      for (const treffer of readFileSync(join(ordner, name), 'utf8').matchAll(muster)) {
        gelesen.push(treffer[1].replace(/\$\{[^}]*\}/g, '*'));
      }
    }
  }
  if (gelesen.length === 0) return;
  const freigaben = (m.web_accessible_resources ?? []).flatMap((w) => w.resources ?? []);
  for (const pfad of gelesen) {
    const passt = freigaben.some((f) => {
      const teile = f.split('*').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return new RegExp(`^${teile.join('[^/]*')}$`).test(pfad);
    });
    if (!passt) fehler.push(`src/inhalt liest "${pfad}", aber web_accessible_resources gibt es nicht frei`);
  }
}

function pruefe(ziel) {
  const ordner = join(ausWurzel, ziel);
  const fehler = [];
  const hinweise = [];

  if (!existsSync(ordner)) return { fehler: [`${ordner} gibt es nicht. Erst \`npm run build\` fahren.`], hinweise };

  const manifestPfad = join(ordner, 'manifest.json');
  if (!existsSync(manifestPfad)) return { fehler: ['manifest.json fehlt'], hinweise };

  let m;
  try {
    m = JSON.parse(readFileSync(manifestPfad, 'utf8'));
  } catch (e) {
    return { fehler: [`manifest.json ist kein gueltiges JSON: ${e.message}`], hinweise };
  }

  if (m.manifest_version !== 3) fehler.push(`manifest_version ist ${m.manifest_version}, erwartet 3`);
  if (!m.version) fehler.push('version fehlt');
  if (!m.default_locale) fehler.push('default_locale fehlt; der Name bliebe __MSG_extName__');

  const wege = [m.background?.service_worker, m.background?.scripts].filter(Boolean).length;
  if (wege !== 1) fehler.push(`${wege} Hintergrundformen im Manifest, erwartet genau eine`);

  let geprueft = 0;
  for (const { wo, pfad } of sammlePfade(m)) {
    const voll = join(ordner, pfad);
    geprueft += 1;
    if (!existsSync(voll)) {
      fehler.push(`${wo} zeigt auf "${pfad}", die Datei fehlt im Paket`);
      continue;
    }
    if (statSync(voll).isFile() && statSync(voll).size === 0) hinweise.push(`${wo}: "${pfad}" ist leer`);
  }

  // Der Name muss in der Vorgabesprache wirklich dastehen, nicht nur die Datei.
  if (m.default_locale) {
    const nachrichten = join(ordner, '_locales', m.default_locale, 'messages.json');
    if (existsSync(nachrichten)) {
      try {
        const n = JSON.parse(readFileSync(nachrichten, 'utf8'));
        for (const schluessel of ['extName', 'extDescription']) {
          if (!n[schluessel]?.message) fehler.push(`_locales/${m.default_locale}/messages.json: "${schluessel}" fehlt oder ist leer`);
        }
      } catch (e) {
        fehler.push(`_locales/${m.default_locale}/messages.json ist kein gueltiges JSON: ${e.message}`);
      }
    }
  }

  // Regellisten sind der halbe Zweck der Erweiterung; ein leeres Array laedt
  // der Browser klaglos und blockt dann nichts.
  for (const r of m.declarative_net_request?.rule_resources ?? []) {
    const voll = join(ordner, r.path);
    if (!existsSync(voll)) continue;
    try {
      const regeln = JSON.parse(readFileSync(voll, 'utf8'));
      if (!Array.isArray(regeln)) fehler.push(`${r.path} ist kein Array`);
      else if (regeln.length === 0) hinweise.push(`${r.path} enthaelt keine einzige Regel`);
    } catch (e) {
      fehler.push(`${r.path} ist kein gueltiges JSON: ${e.message}`);
    }
  }

  freigabenPruefen(m, fehler);
  const budget = regelbudget(m, ordner, fehler, hinweise);
  return { fehler, hinweise, geprueft, version: m.version, dateien: zaehle(ordner), budget };
}

/**
 * Passen die beim Start AKTIVEN Regeln in Chromes Budget?
 *
 * ── Warum das hier steht und nicht nur im Test ────────────────────────────
 * Ein Test faellt beim Entwickeln auf. Diese Pruefung faellt auf, wenn jemand
 * ein Paket baut und hochlaedt -- und das ist der Moment, in dem der Fehler
 * teuer wird: Chrome laedt zu viele Regeln NICHT, aber ohne Fehler. Die
 * Erweiterung installiert sich sauber, das Popup zaehlt weiter, und einzelne
 * Listen blocken einfach nicht. Von aussen sieht das aus wie eine Liste, die
 * nichts findet.
 *
 * Gezaehlt wird aus dem GEBAUTEN Paket, nicht aus der Quelle: Was im Manifest
 * `enabled` steht und was in der Regeldatei daneben liegt, ist das, was der
 * Browser sieht. Ein Test an der Quelle kann gruen sein, waehrend der Build
 * etwas anderes ausliefert.
 *
 * Der Hinweis kommt schon bei neunzig Prozent. Die harte Grenze warnt zu
 * spaet: Wer sie reisst, hat das Paket schon gebaut.
 */
function regelbudget(m, ordner, fehler, hinweise) {
  const saetze = m.declarative_net_request?.rule_resources ?? [];
  if (saetze.length === 0) return null;

  let aktiv = 0;
  let gesamt = 0;
  for (const satz of saetze) {
    const datei = join(ordner, satz.path);
    if (!existsSync(datei)) continue; // fehlende Pfade meldet die Pfadpruefung
    let n = 0;
    try {
      const inhalt = JSON.parse(readFileSync(datei, 'utf8'));
      n = Array.isArray(inhalt) ? inhalt.length : 0;
    } catch {
      continue; // ungueltiges JSON meldet die Schemapruefung beim Bauen
    }
    gesamt += n;
    if (satz.enabled) aktiv += n;
  }

  if (saetze.length > REGELSAETZE_MAX) {
    fehler.push(`${saetze.length} Regelsaetze im Manifest, Chrome erlaubt ${REGELSAETZE_MAX}.`);
  }

  const anteil = Math.round((aktiv / REGELN_GARANTIERT) * 100);
  if (aktiv > REGELN_GARANTIERT) {
    fehler.push(
      `${aktiv.toLocaleString('de-DE')} Regeln sind ab Werk aktiv, Chrome garantiert ` +
        `${REGELN_GARANTIERT.toLocaleString('de-DE')} (${anteil} %). Was darueber liegt, laedt ` +
        `Chrome NICHT -- ohne Fehler. Eine Liste auf standard:false setzen oder ihr Budget senken.`,
    );
  } else if (anteil >= 90) {
    hinweise.push(
      `Regelbudget zu ${anteil} % belegt (${aktiv.toLocaleString('de-DE')} von ` +
        `${REGELN_GARANTIERT.toLocaleString('de-DE')}, noch ` +
        `${(REGELN_GARANTIERT - aktiv).toLocaleString('de-DE')} frei). Die Listen wachsen bei ` +
        `jedem listen:bauen -- jetzt handeln, nicht erst beim Reissen.`,
    );
  }
  return { aktiv, gesamt, anteil };
}

function zaehle(ordner) {
  let dateien = 0;
  let bytes = 0;
  const lauf = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const voll = join(p, e.name);
      if (e.isDirectory()) lauf(voll);
      else {
        dateien += 1;
        bytes += statSync(voll).size;
      }
    }
  };
  lauf(ordner);
  return { dateien, bytes };
}

/*
 * Chromes Grenzen. Sie stehen auch in `src/gemeinsam/konstanten.ts`
 * (DNR_REGELN_GARANTIERT, DNR_REGELSAETZE_MAX) -- dieses Skript laeuft aber
 * ohne TypeScript-Lader und kann sie nicht importieren. Test
 * `tests/hintergrund/regelbudget.test.ts` haelt beide Zahlen gegeneinander,
 * damit aus den zwei Stellen nicht zwei verschiedene Wahrheiten werden.
 */
const REGELN_GARANTIERT = 30_000;
const REGELSAETZE_MAX = 100;

let schlecht = 0;
for (const ziel of ziele) {
  const { fehler, hinweise, geprueft, version, dateien, budget } = pruefe(ziel);
  for (const h of hinweise ?? []) console.warn(`[pruefe ${ziel}] Hinweis: ${h}`);
  if (fehler.length) {
    schlecht += 1;
    for (const f of fehler) console.error(`[pruefe ${ziel}] FEHLER: ${f}`);
  } else {
    const mb = (dateien.bytes / 1024 / 1024).toFixed(1);
    const b = budget ? `, ${budget.aktiv.toLocaleString('de-DE')}/${REGELN_GARANTIERT.toLocaleString('de-DE')} Regeln aktiv (${budget.anteil} %)` : '';
    console.log(`[pruefe ${ziel}] v${version}: ${geprueft} Manifest-Pfade vorhanden, ${dateien.dateien} Dateien, ${mb} MB${b}`);
  }
}

if (schlecht > 0) {
  console.error(`pruefe-paket: ${schlecht} von ${ziele.length} Zielen fehlerhaft.`);
  process.exit(1);
}
console.log(`pruefe-paket: ${ziele.length} Ziel(e) in Ordnung.`);
