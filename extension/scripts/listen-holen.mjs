#!/usr/bin/env node
/**
 * Holt die Filterlisten aus `listen/quellen.json` und legt je Quelle eine
 * Momentaufnahme ab:
 *
 *     listen/quellen/<id>.txt        der rohe Listentext
 *     listen/quellen/<id>.meta.json  wann, woher, wie gross, Prüfsumme
 *
 * Die Momentaufnahmen werden COMMITTET. Der Build (`listen-bauen.mjs`) liest
 * nur sie und nie das Netz. So ist ein Build reproduzierbar, und ein Ausfall
 * von easylist.to bricht keinen Release ab.
 *
 * Ohne Netz: vorhandene Momentaufnahme behalten und WARNEN. Fehlt sie ganz,
 * ist das ein Fehler (Exit 1), denn ein leeres Ruleset wäre ein Werbeblocker,
 * der nichts blockt und es nicht sagt.
 *
 * `--aus=<ordner>`: NICHT aus dem Netz, sondern aus Dateien auf der Platte.
 * Je Quelle, die in `quellen.json` ein Feld `datei` trägt, wird
 * `<ordner>/<datei>` als Momentaufnahme übernommen; Quellen ohne `datei` oder
 * ohne Datei im Ordner behalten ihren Stand. Das ist der Weg für Listen, die
 * jemand von Hand geholt und in den Wurzelordner `listen/` gelegt hat
 * (`npm run listen:einlesen` im Wurzelverzeichnis). Dieselbe Prüfung wie
 * beim Netz: Was nicht mit `[Adblock` oder `!` beginnt, ist keine Liste.
 * Trägt die Datei einen anderen `! Title:` als die bisherige Momentaufnahme,
 * wird sie NICHT übernommen und der Lauf endet mit 1. Eine Warnung allein
 * hielte nichts auf: `listen:einlesen` verkettet Holen und Bauen mit `&&`,
 * der Build liefe also über die vertauschte Datei, und in `rules/basis.json`
 * stünde am Ende EasyPrivacy. Wer einen echten Titelwechsel übernehmen will,
 * gibt `--erzwingen` dazu.
 *
 * Fehlt der Ordner, ist auch das ein Fehler (Exit 1) und keine Warnung.
 * Sonst hiesse ein Tippfehler im Pfad still „alles behalten", der Build
 * liefe über die alten Stände, und beide Schritte meldeten Erfolg.
 *
 * Aufruf: node scripts/listen-holen.mjs [--nur=<id>[,<id>]] [--zeit=<sekunden>] [--aus=<ordner>]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLEN_DATEI = join(WURZEL, 'listen', 'quellen.json');
const ZIEL_ORDNER = join(WURZEL, 'listen', 'quellen');

const argumente = new Map(
  process.argv.slice(2).map((a) => {
    const [schluessel, wert = 'true'] = a.replace(/^--/, '').split('=');
    return [schluessel, wert];
  }),
);
const nurIds = argumente.has('nur') ? argumente.get('nur').split(',') : null;
const zeitS = Number(argumente.get('zeit') ?? 60);
const erzwingen = argumente.has('erzwingen');
const ausOrdner = argumente.has('aus') ? resolve(WURZEL, argumente.get('aus')) : null;

// Ein Pfad, den es nicht gibt, ist ein Fehler und keine Warnung. `--aus` ohne
// Wert kommt als 'true' aus dem Parser an und wäre sonst der Ordner "true".
if (ausOrdner !== null) {
  const wert = argumente.get('aus');
  if (wert === 'true' || wert === '') {
    process.stderr.write('--aus braucht einen Ordner, z. B. --aus=../listen\n');
    process.exit(1);
  }
  if (!existsSync(ausOrdner)) {
    process.stderr.write(`--aus: den Ordner ${ausOrdner} gibt es nicht.\n`);
    process.exit(1);
  }
}

/** Kopfzeilen der Liste (`! Title:`, `! Version:` ...) als Objekt. */
function kopfzeilen(text) {
  const ergebnis = {};
  for (const zeile of text.split(/\r?\n/).slice(0, 40)) {
    const treffer = /^!\s*([A-Za-z ]+?):\s*(.+)$/.exec(zeile);
    if (!treffer) continue;
    const name = treffer[1].trim().toLowerCase().replace(/\s+/g, '-');
    if (!(name in ergebnis)) ergebnis[name] = treffer[2].trim();
  }
  return ergebnis;
}

/**
 * Eine Liste ohne Kopfzeile ist keine Liste.
 *
 * Der Zweck ist, eine HTML-Fehlerseite abzufangen, bevor sie als Filterliste
 * durchgeht - ein 404 mit Statuscode 200 sieht sonst aus wie eine leere Liste,
 * und die naechste Erneuerung loescht still tausende Regeln.
 *
 * Zwei Formen zaehlen als Kopf. `[Adblock Plus 2.0]` ist die verbreitete;
 * `[uBlock Origin]` steht ueber den Listen aus dem uAssets-Bestand. Und der
 * BOM davor: `lan-block.txt` beginnt mit U+FEFF, das ist kein Leerraum, an dem
 * `\s*` vorbeikaeme - genau daran ist die Liste beim ersten Versuch gescheitert.
 */
function siehtAusWieListe(text) {
  const ohneBom = text.replace(/^\uFEFF/, '');
  return /^\s*\[(Adblock|uBlock)/i.test(ohneBom) || ohneBom.startsWith('!');
}

/**
 * Momentaufnahme aus einer Datei statt aus dem Netz. `null`, wenn die Quelle
 * keinen Dateinamen kennt oder die Datei im Ordner fehlt; dann bleibt der
 * alte Stand, und der Aufrufer sagt es.
 */
function holeAusDatei(quelle, ordner = ausOrdner) {
  if (!quelle.datei) return null;
  const pfad = join(ordner, quelle.datei);
  if (!existsSync(pfad)) return null;
  const text = readFileSync(pfad, 'utf8');
  if (!siehtAusWieListe(text)) {
    throw new Error(`${quelle.datei} sieht nicht wie eine Filterliste aus (kein [Adblock ...]-Kopf)`);
  }
  return { text, etag: null, lastModified: null, ausDatei: relative(WURZEL, pfad) };
}

async function hole(quelle) {
  // `eigen: true` heisst: Diese Liste steht IM Projekt und wird von Hand
  // gepflegt. Sie hat keine URL, also gibt es auch nichts zu holen - sie wird
  // aus `listen/<datei>` uebernommen, in JEDEM Lauf, auch ohne `--aus`. Ohne
  // diesen Zweig liefe der Netzzweig gegen `undefined` und die eigene Liste
  // waere nach dem naechsten `listen:holen` still verschwunden.
  if (quelle.eigen) return holeAusDatei(quelle, join(WURZEL, 'listen'));
  if (ausOrdner) return holeAusDatei(quelle);
  const steuerung = new AbortController();
  const wecker = setTimeout(() => steuerung.abort(), zeitS * 1000);
  try {
    const antwort = await fetch(quelle.url, {
      signal: steuerung.signal,
      headers: { 'user-agent': 'AdSilence-Listenbau/1.0 (+https://adsilence.net)' },
      redirect: 'follow',
    });
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
    const text = await antwort.text();
    // Eine Liste ohne Kopfzeile ist keine Liste; so fällt eine HTML-Fehlerseite
    // mit Status 200 auf, statt als Momentaufnahme gespeichert zu werden.
    if (!siehtAusWieListe(text)) {
      throw new Error('Antwort sieht nicht wie eine Filterliste aus (kein [Adblock ...]-Kopf)');
    }
    return {
      text,
      etag: antwort.headers.get('etag'),
      lastModified: antwort.headers.get('last-modified'),
      ausDatei: null,
    };
  } finally {
    clearTimeout(wecker);
  }
}

async function main() {
  const quellen = JSON.parse(readFileSync(QUELLEN_DATEI, 'utf8'));
  mkdirSync(ZIEL_ORDNER, { recursive: true });

  let fehler = 0;
  let uebernommen = 0;
  for (const quelle of quellen) {
    if (nurIds && !nurIds.includes(quelle.id)) continue;
    const textPfad = join(ZIEL_ORDNER, `${quelle.id}.txt`);
    const metaPfad = join(ZIEL_ORDNER, `${quelle.id}.meta.json`);
    const herkunft = quelle.eigen
      ? join('listen', quelle.datei)
      : ausOrdner
        ? quelle.datei
          ? join(ausOrdner, quelle.datei)
          : '(keine datei in quellen.json)'
        : quelle.url;
    process.stdout.write(`${quelle.id.padEnd(14)} ${herkunft}\n`);
    try {
      const geholt = await hole(quelle);
      if (geholt === null) {
        // Nur im Dateimodus: nichts zu übernehmen, der alte Stand bleibt.
        // Eine Quelle ohne Datei ist im Dateimodus kein Fehler, solange sie
        // schon eine Momentaufnahme hat; ohne die kann der Build nichts bauen.
        if (existsSync(textPfad)) {
          const alt = existsSync(metaPfad) ? JSON.parse(readFileSync(metaPfad, 'utf8')) : {};
          process.stdout.write(`  keine Datei; behalte Momentaufnahme vom ${alt.geholtAm ?? 'unbekannt'}.\n`);
        } else {
          fehler += 1;
          process.stdout.write('  FEHLER: keine Datei und keine Momentaufnahme vorhanden.\n');
        }
        continue;
      }
      const { text, etag, lastModified, ausDatei } = geholt;
      const kopf = kopfzeilen(text);
      if (ausDatei && existsSync(metaPfad)) {
        const alt = JSON.parse(readFileSync(metaPfad, 'utf8'));
        if (alt.titel && kopf['title'] && alt.titel !== kopf['title'] && !erzwingen) {
          fehler += 1;
          process.stdout.write(
            `  FEHLER: Titel "${kopf['title']}" statt bisher "${alt.titel}". Vertauschte Datei?\n` +
              '         Momentaufnahme NICHT übernommen. Wenn der Titel sich wirklich geändert hat: --erzwingen\n',
          );
          continue;
        }
      }
      const meta = {
        id: quelle.id,
        name: quelle.name,
        url: quelle.url,
        geholtAm: new Date().toISOString(),
        bytes: Buffer.byteLength(text, 'utf8'),
        zeilen: text.split(/\r?\n/).length,
        sha256: createHash('sha256').update(text).digest('hex'),
        titel: kopf['title'] ?? null,
        version: kopf['version'] ?? null,
        zuletztGeaendert: kopf['last-modified'] ?? lastModified ?? null,
        lizenz: kopf['licence'] ?? kopf['license'] ?? null,
        etag: etag ?? null,
        // Woher die Momentaufnahme wirklich kam: null heisst aus dem Netz
        // (`url`), sonst der Pfad der Datei, relativ zu `extension/`.
        ausDatei: ausDatei ?? null,
      };
      writeFileSync(textPfad, text);
      writeFileSync(metaPfad, JSON.stringify(meta, null, 2) + '\n');
      uebernommen += 1;
      process.stdout.write(`  ${meta.zeilen} Zeilen, ${(meta.bytes / 1024).toFixed(0)} kB, Version ${meta.version ?? '?'}\n`);
    } catch (e) {
      const grund = e instanceof Error ? e.message : String(e);
      if (existsSync(textPfad)) {
        const alt = existsSync(metaPfad) ? JSON.parse(readFileSync(metaPfad, 'utf8')) : {};
        process.stdout.write(`  WARNUNG: ${grund}. Behalte Momentaufnahme vom ${alt.geholtAm ?? 'unbekannt'}.\n`);
      } else {
        fehler += 1;
        process.stdout.write(`  FEHLER: ${grund}. Keine Momentaufnahme vorhanden.\n`);
      }
    }
  }
  // Ein Dateilauf, der nichts übernommen hat, hat sein Ziel verfehlt - der
  // Ordner ist da, aber keine Datei darin passt zu einem `datei`-Feld in
  // `quellen.json`. Ohne diese Zeile bauten die `&&`-verketteten Schritte
  // danach die alten Stände und meldeten Erfolg.
  if (ausOrdner !== null && uebernommen === 0) {
    process.stdout.write(
      `\nKeine einzige Datei übernommen. Trägt ${ausOrdner} die Dateinamen aus dem Feld "datei" in listen/quellen.json?\n`,
    );
    process.exit(1);
  }
  if (fehler > 0) {
    process.stdout.write(`\n${fehler} Quelle(n) nicht übernommen. Der Build liefe sonst über einen alten oder falschen Stand.\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
