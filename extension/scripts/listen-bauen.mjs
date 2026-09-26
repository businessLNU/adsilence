#!/usr/bin/env node
/**
 * Baut aus den Momentaufnahmen in `listen/quellen/` die Dateien, die die
 * Erweiterung ausliefert:
 *
 *     rules/<id>.json         DNR-Regeln (Chrome-Schema), je Liste ein Ruleset
 *     kosmetik/<id>.json      { generisch, spezifisch, ausnahmen }
 *     kosmetik/generisch.css  Vereinigung der generischen Selektoren aller
 *                             Standardlisten, als document_start-Stylesheet
 *     scriptlets/<id>.json    { host: [ { name, args } ] }
 *     popup/<id>.json         { hosts: [...], ausnahmen: [...] }
 *     prozedural/<id>.json    { host: [ { wahl, text } ] }
 *     listen/bericht.json     was gelesen, umgesetzt, verworfen wurde
 *
 * Es liest NUR die Momentaufnahmen, nie das Netz (`listen-holen.mjs` tut das).
 * Fehlt eine, bricht der Build ab: Ein leeres Ruleset wäre ein Werbeblocker,
 * der nichts blockt und es nicht sagt.
 *
 * Die Engine wird als `.ts` importiert. Node 26 streift Typen selbst ab
 * (Type Stripping, seit Node 23.6 ohne Schalter); dafür muss jeder Import in
 * `src/engine/` die Endung `.ts` tragen und der Code ohne Enums, Namespaces
 * und Parameter-Eigenschaften auskommen. Kein tsx, kein Bauschritt vor dem
 * Bauschritt. Wer eine ältere Node-Version hat, sieht hier den ersten Fehler.
 *
 * Aufruf: node scripts/listen-bauen.mjs [--nur=<id>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  alsStylesheet,
  nackteHostzeilen,
  parseListe,
  pruefeRegelsatz,
  zuDnr,
  zuKosmetik,
  zuPopupHosts,
  zuTextregeln,
  zuScriptlets,
} from '../src/engine/index.ts';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLEN = JSON.parse(readFileSync(join(WURZEL, 'listen', 'quellen.json'), 'utf8'));

const argumente = new Map(
  process.argv.slice(2).map((a) => {
    const [schluessel, wert = 'true'] = a.replace(/^--/, '').split('=');
    return [schluessel, wert];
  }),
);
const nurIds = argumente.has('nur') ? argumente.get('nur').split(',') : null;

for (const ordner of ['rules', 'kosmetik', 'scriptlets', 'popup', 'prozedural']) {
  mkdirSync(join(WURZEL, ordner), { recursive: true });
}

/**
 * JSON mit UMBRUECHEN: ein Eintrag je Zeile, sonst nichts eingerueckt.
 *
 * ── Wogegen das steht ─────────────────────────────────────────────────────
 * `JSON.stringify(wert)` schreibt alles in EINE Zeile. GEMESSEN am 14.09.2026
 * im fertigen Paket: `rules/privatsphaere.json` — eine Zeile mit 2.525.976
 * Zeichen, `kosmetik/laestig.json` 1.973.876, `rules/basis.json` 1.722.284.
 *
 * AMO hat dasselbe Paket einmal angenommen („0 Fehler, 5 Warnungen") und
 * zweimal mit „Validation was unable to complete successfully due to an
 * unexpected error" abgewiesen — derselbe Inhalt, verschiedenes Ergebnis. Ein
 * Pruefer, der zeilenweise liest, haelt eine Zeile dieser Laenge im Speicher;
 * dass es mal reicht und mal nicht, passt dazu.
 *
 * Beweisen laesst sich das von hier aus nicht — der Prueflauf liegt bei
 * Mozilla. Ein Ausreisser dieser Groessenordnung ist aber auch ohne Beweis
 * nichts, was man stehen laesst.
 *
 * Der Inhalt aendert sich nicht, nur die Umbrueche. Was es zusaetzlich
 * bringt: Diese Dateien liegen im Repo und gehen als Quelltext an die
 * Pruefung. Als eine Zeile sind sie fuer einen Menschen nicht lesbar und in
 * einem Diff nicht zu vergleichen; je Eintrag eine Zeile schon.
 *
 * Kosten: ein Byte je Eintrag. Im gepackten Archiv faellt das nicht ins
 * Gewicht, Umbrueche komprimieren sich weg.
 */
function schreibeJson(pfad, wert) {
  writeFileSync(join(WURZEL, pfad), mitUmbruechen(wert) + '\n');
}

/**
 * Rekursiv, aber nur ZWEI Ebenen tief — und genau deshalb.
 *
 * `kosmetik/<id>.json` ist ein Objekt aus drei Feldern, und eines davon
 * (`generisch`) ist eine Liste mit 27.341 Selektoren. Eine Fassung, die nur
 * die obersten Schluessel umbricht, liess dieses eine Feld als Zeile mit
 * 1.361.655 Zeichen stehen — der Ausreisser waere geblieben, nur eine Ebene
 * tiefer.
 *
 * Tiefer als zwei Ebenen wird nicht aufgebrochen: Ein einzelner Eintrag
 * (eine DNR-Regel, die Selektoren eines Hosts) gehoert zusammen und ist
 * einige hundert Zeichen lang. Ihn zu zerlegen macht die Datei laenger,
 * ohne sie lesbarer zu machen.
 */
function mitUmbruechen(wert, tiefe = 0) {
  if (tiefe > 1 || wert === null || typeof wert !== 'object') return JSON.stringify(wert);

  if (Array.isArray(wert)) {
    if (wert.length === 0) return '[]';
    return `[\n${wert.map((e) => mitUmbruechen(e, tiefe + 1)).join(',\n')}\n]`;
  }

  const paare = Object.entries(wert);
  if (paare.length === 0) return '{}';
  return `{\n${paare.map(([k, v]) => `${JSON.stringify(k)}:${mitUmbruechen(v, tiefe + 1)}`).join(',\n')}\n}`;
}

function summe(objekt) {
  return Object.values(objekt).reduce((a, b) => a + b, 0);
}

const bericht = {};
const generischAlle = new Set();
let probleme = 0;

for (const quelle of QUELLEN) {
  if (nurIds && !nurIds.includes(quelle.id)) continue;
  const textPfad = join(WURZEL, 'listen', 'quellen', `${quelle.id}.txt`);
  const metaPfad = join(WURZEL, 'listen', 'quellen', `${quelle.id}.meta.json`);
  if (!existsSync(textPfad)) {
    process.stderr.write(`${quelle.id}: keine Momentaufnahme unter listen/quellen/. Zuerst: npm run listen:holen\n`);
    process.exit(1);
  }
  const rohtext = readFileSync(textPfad, 'utf8');
  const text = quelle.nackteHosts === true ? nackteHostzeilen(rohtext) : rohtext;
  const meta = existsSync(metaPfad) ? JSON.parse(readFileSync(metaPfad, 'utf8')) : {};

  const regeln = parseListe(text);
  const verworfen = {};
  for (const regel of regeln) {
    if (regel.typ === 'unbekannt') verworfen[regel.grund] = (verworfen[regel.grund] ?? 0) + 1;
  }

  const dnr = zuDnr(regeln, {
    startId: 1,
    budget: quelle.budget,
    blocktNavigation: quelle.blocktNavigation === true,
  });
  for (const [grund, n] of Object.entries(dnr.verworfen)) verworfen[grund] = (verworfen[grund] ?? 0) + n;

  const kosmetik = zuKosmetik(regeln, verworfen);
  // uBlocks eigene Listen und unsere: Nur sie duerfen Antworten umschreiben
  // (`brauchtVertrauen()` in src/engine/scriptlets.ts).
  const vertrauenswuerdig = quelle.eigen === true || quelle.id.startsWith('ublock');
  const scriptlets = zuScriptlets(regeln, verworfen, { vertrauenswuerdig });
  const popups = zuPopupHosts(regeln, verworfen);
  const textregeln = zuTextregeln(regeln);

  const fehler = pruefeRegelsatz(dnr.rules, quelle.budget);
  if (fehler.length > 0) {
    probleme += fehler.length;
    process.stderr.write(`${quelle.id}: ${fehler.length} Schemaprobleme\n  ${fehler.slice(0, 10).join('\n  ')}\n`);
  }

  schreibeJson(`rules/${quelle.id}.json`, dnr.rules);
  schreibeJson(`kosmetik/${quelle.id}.json`, kosmetik);
  schreibeJson(`scriptlets/${quelle.id}.json`, scriptlets);
  schreibeJson(`popup/${quelle.id}.json`, popups);
  schreibeJson(`prozedural/${quelle.id}.json`, textregeln);

  // ── Je Liste ein eigenes Stylesheet, nicht ein gemeinsames ────────────────
  //
  // GEMESSEN am 03.09.2026 in Chrome for Testing 131 mit der gebauten Fassung:
  // Der Hintergrunddienst meldet die generische Kosmetik ueber
  // `scripting.registerContentScripts` an, und zwar je AKTIVER Liste unter dem
  // Pfad `kosmetik/<id>.generisch.css` (src/hintergrund/regeln.ts). Gebaut
  // wurde bis dahin nur eine gemeinsame `kosmetik/generisch.css`. Die Pfade
  // trafen sich also nie: `paketDateiVorhanden()` gab jedes Mal false, die
  // Registrierung wurde uebersprungen, und auf der Koederseite blieben
  // `#ad-container` und `.ad-banner` sichtbar - 0 von 4 kosmetischen Proben.
  //
  // Je Liste eine Datei ist ausserdem das richtige Modell: Wer eine Liste
  // abschaltet, soll auch deren Selektoren los sein. Ein gemeinsames Blatt
  // koennte das nicht.
  writeFileSync(
    join(WURZEL, 'kosmetik', `${quelle.id}.generisch.css`),
    alsStylesheet(kosmetik.generisch, 500) + '\n',
  );

  if (quelle.standard) for (const s of kosmetik.generisch) generischAlle.add(s);

  const netz = regeln.filter((r) => r.typ === 'netz').length;
  const scriptletAnzahl = Object.values(scriptlets).reduce((a, l) => a + l.length, 0);
  bericht[quelle.id] = {
    name: quelle.name,
    gebautAm: new Date().toISOString(),
    quelleVom: meta.geholtAm ?? null,
    quellVersion: meta.version ?? null,
    budget: quelle.budget,
    gelesen: regeln.length,
    netz,
    dnr: dnr.rules.length,
    dnrQuellregeln: dnr.quellregeln,
    dnrKlassen: dnr.klassen,
    dnrRegex: dnr.rules.filter((r) => r.condition.regexFilter !== undefined).length,
    kosmetikGenerisch: kosmetik.generisch.length,
    kosmetikSpezifisch: Object.values(kosmetik.spezifisch).reduce((a, l) => a + l.length, 0),
    kosmetikAusnahmen: Object.values(kosmetik.ausnahmen).reduce((a, l) => a + l.length, 0),
    scriptlets: scriptletAnzahl,
    popupHosts: popups.hosts.length,
    textregeln: Object.values(textregeln).reduce((a, l) => a + l.length, 0),
    verworfen: Object.fromEntries(Object.entries(verworfen).sort((a, b) => b[1] - a[1])),
  };

  const b = bericht[quelle.id];
  process.stdout.write(
    `${quelle.id.padEnd(14)} gelesen ${String(b.gelesen).padStart(6)}  netz ${String(netz).padStart(6)}  ` +
      `dnr ${String(b.dnr).padStart(5)}/${quelle.budget} (${dnr.quellregeln} Zeilen)  kosmetik ${String(b.kosmetikGenerisch).padStart(5)} generisch ` +
      `${String(b.kosmetikSpezifisch).padStart(5)} spezifisch  scriptlets ${String(scriptletAnzahl).padStart(3)}  ` +
      `popup ${String(popups.hosts.length).padStart(4)}  ` +
      `text ${String(Object.values(textregeln).reduce((a, l) => a + l.length, 0)).padStart(4)}  ` +
      `verworfen ${summe(verworfen)}\n`,
  );
}

if (!nurIds) {
  const generisch = Array.from(generischAlle);
  writeFileSync(join(WURZEL, 'kosmetik', 'generisch.css'), alsStylesheet(generisch, 500) + '\n');
  process.stdout.write(`generisch.css   ${generisch.length} Selektoren in ${Math.ceil(generisch.length / 500)} Gruppen\n`);
}

const alt = existsSync(join(WURZEL, 'listen', 'bericht.json'))
  ? JSON.parse(readFileSync(join(WURZEL, 'listen', 'bericht.json'), 'utf8'))
  : {};
writeFileSync(join(WURZEL, 'listen', 'bericht.json'), JSON.stringify({ ...alt, ...bericht }, null, 2) + '\n');

if (probleme > 0) {
  process.stderr.write(`\n${probleme} Schemaprobleme. Diese Rulesets würde Chrome beim Laden ablehnen.\n`);
  process.exit(1);
}
