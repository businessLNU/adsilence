#!/usr/bin/env node
/**
 * Ein ladbares Paket je Browser bauen.
 *
 *   node scripts/build.mjs --ziel=chromium|firefox|safari|alle [--watch] [--aus=dist]
 *
 * Es gibt genau EIN Bauskript, und es macht die vier Schritte in dieser
 * Reihenfolge:
 *
 *   1. esbuild buendelt Hintergrund und Inhaltsskripte nach
 *      `dist/<ziel>/{hintergrund,inhalt}/`. Kein Hash im Namen, kein
 *      Code-Splitting: Der Hintergrund ist ein Service Worker, ein
 *      Inhaltsskript wird vom Browser als EINE Datei geladen. Ein zweiter
 *      Chunk daneben wuerde nie geladen.
 *   2. Vite baut Popup und Optionsseite (React, HTML-Einstiege) in denselben
 *      Ordner. Die Einzelheiten stehen in `vite.config.ts`.
 *   3. Beiwerk kopieren: Regeln, Kosmetik, Scriptlets, Symbole, `_locales`.
 *   4. `scripts/manifest.mjs` mischt Basis und Overlay zum `manifest.json`.
 *
 * Reihenfolge ist nicht Geschmack: Vite darf seinen Ausgabeordner nicht
 * leeren (`emptyOutDir: false`), sonst waere der Hintergrund aus Schritt 1
 * wieder weg. Und das Manifest kommt zuletzt, weil es nur Rulesets nennen
 * darf, deren Datei wirklich im Paket liegt.
 *
 * FEHLENDE EINGABEN SIND WARNUNGEN, KEIN ABBRUCH. Wer die Erweiterung
 * anschauen will, bevor `npm run listen:bauen` gelaufen ist, bekommt ein
 * Paket ohne Filterlisten, aber eines, das der Browser laedt. Nur echte
 * Fehler (ein Syntaxfehler im Quelltext) beenden den Lauf mit Status 1.
 *
 * Die drei Bauzeit-Konstanten (`src/gemeinsam/umgebung.d.ts`) kommen aus
 * `extension/.env` bzw. der Umgebung; im Quelltext steht keine Adresse.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { liesEnv, schreibeManifest, WURZEL, ZIELE } from './manifest.mjs';

// ── Aufrufparameter ────────────────────────────────────────────────────────

function argument(name, vorgabe) {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : vorgabe;
}
function schalter(name) {
  return process.argv.includes(`--${name}`);
}

const zielArg = argument('ziel', 'chromium');
const ausWurzel = argument('aus', join(WURZEL, 'dist'));
const beobachten = schalter('watch');

if (zielArg !== 'alle' && !ZIELE.includes(zielArg)) {
  console.error(`build: unbekanntes Ziel "${zielArg}" (erlaubt: ${ZIELE.join(', ')}, alle)`);
  process.exit(1);
}
const ziele = zielArg === 'alle' ? [...ZIELE] : [zielArg];

// ── Bauzeit-Konstanten ─────────────────────────────────────────────────────

const paket = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8'));
// Die echte Umgebung schlaegt die `.env`, so laesst sich ein Release-Build
// mit `ADSILENCE_API=… npm run build` fahren, ohne die Datei anzufassen.
const umgebung = { ...liesEnv(join(WURZEL, '.env')), ...process.env };

/*
 * ── Woher die Serveradresse kommt, und warum nicht mehr aus localhost ──────
 *
 * Reihenfolge: ADSILENCE_API aus der Umgebung → FRONTEND_URL aus der `.env`
 * DES PROJEKTS eine Ebene hoeher → erst dann localhost.
 *
 * Vorher stand direkt hinter ADSILENCE_API der Rueckfall
 * `http://localhost:3000`. Wer die Variable nicht setzte — und sie steht in
 * keiner Datei, sie muss beim Aufruf mitgegeben werden — baute ein Paket, das
 * einen Server auf dem Rechner des KUNDEN sucht. Es installiert sich sauber,
 * blockt einwandfrei (die Filterregeln liegen im Paket), und nur Anmelden,
 * Lizenz und Listenpflege scheitern. In der Oberflaeche steht dann „Keine
 * Verbindung zum Dienst" — ein Satz, der nach einem Netzproblem aussieht.
 *
 * GEMESSEN am 06.09.2026: Zwei Pakete derselben Version nebeneinander, eines
 * mit adsilence.net gebaut, eines ohne die Variable. Am zweiten liess sich
 * kein Konto verbinden, und von aussen war den beiden nichts anzusehen.
 *
 * Die `.env` des Projekts ist die richtige Quelle: Dort steht die Adresse
 * ohnehin schon, fuer das Backend und die Anwendung. Eine zweite Stelle waere
 * eine, die beim naechsten Umzug vergessen wird.
 */
const projektEnv = liesEnv(join(WURZEL, '..', '.env'));
const API = (umgebung.ADSILENCE_API || projektEnv.FRONTEND_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
if (!umgebung.ADSILENCE_API && !projektEnv.FRONTEND_URL) {
  console.warn(
    '[build] WARNUNG: Weder ADSILENCE_API noch FRONTEND_URL gefunden — das Paket zeigt auf ' +
      'localhost. Anmelden, Lizenz und Listenpflege scheitern damit auf jedem fremden Rechner.',
  );
}
console.log(`[build] Serveradresse im Paket: ${API}`);
const VERSION = paket.version ?? '0.0.0';

/** Untergrenzen der drei Ziele, gemeinsam gesetzt: ein Paket, ein Code. */
const ZIELVERSIONEN = ['chrome121', 'firefox128', 'safari17'];

function definitionen(ziel) {
  const env = { ADSILENCE_API: API, VERSION, BROWSER: ziel };
  return {
    // Zwei Formen, weil beide im Quelltext vorkommen duerfen: das ganze
    // Objekt (`src/gemeinsam/konstanten.ts` liest es so, damit es in Node
    // ohne Bauschritt `undefined` sein darf) und der einzelne Zugriff.
    'import.meta.env': JSON.stringify(env),
    'import.meta.env.ADSILENCE_API': JSON.stringify(env.ADSILENCE_API),
    'import.meta.env.VERSION': JSON.stringify(env.VERSION),
    'import.meta.env.BROWSER': JSON.stringify(env.BROWSER),
  };
}

// ── Was esbuild baut ───────────────────────────────────────────────────────

/**
 * `format` je Ziel:
 *
 * - Hintergrund: `esm` fuer Chromium und Firefox, denn dort steht
 *   `"type": "module"` im Manifest. Safari bekommt `iife`, denn Event Pages und
 *   Modul-Hintergruende vertragen sich dort nicht zuverlaessig, und das
 *   Safari-Overlay setzt deshalb `"scripts": [...]` ohne `type`.
 * - Inhaltsskripte: immer `iife`. Ein Inhaltsskript ist kein Modul; der
 *   Browser laedt es als klassisches Skript, `import` gaebe einen Fehler in
 *   der Konsole jeder besuchten Seite.
 */
const BUENDEL = [
  {
    eingang: 'src/hintergrund/index.ts',
    ausgang: 'hintergrund/index.js',
    format: (ziel) => (ziel === 'safari' ? 'iife' : 'esm'),
  },
  { eingang: 'src/inhalt/kosmetik.ts', ausgang: 'inhalt/kosmetik.js', format: () => 'iife' },
  { eingang: 'src/inhalt/schatten.ts', ausgang: 'inhalt/schatten.js', format: () => 'iife' },
  { eingang: 'src/inhalt/fingerabdruck.ts', ausgang: 'inhalt/fingerabdruck.js', format: () => 'iife' },
  { eingang: 'src/inhalt/warnung.ts', ausgang: 'inhalt/warnung.js', format: () => 'iife' },
  { eingang: 'src/inhalt/cookies.ts', ausgang: 'inhalt/cookies.js', format: () => 'iife' },
];

function esbuildOptionen(ziel, buendel, aus) {
  return {
    entryPoints: [join(WURZEL, buendel.eingang)],
    outfile: join(aus, buendel.ausgang),
    bundle: true,
    format: buendel.format(ziel),
    target: ZIELVERSIONEN,
    platform: 'browser',
    define: definitionen(ziel),
    // Ein Store-Review liest den Quelltext. Verschleierter Code ist dort ein
    // Grund zur Rueckfrage, und die paar Kilobyte spart ein lokal geladenes
    // Paket nicht ein.
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    // `warning`, nicht `silent`: Ein Hinweis von esbuild auf Syntax, die im
    // Zielbrowser fehlt, soll man sehen. Fehler wirft esbuild ohnehin, und
    // `fehlerText` bringt sie in eine Zeile mit Datei und Zeilennummer.
    logLevel: 'warning',
  };
}

// ── Beiwerk, das nur kopiert wird ──────────────────────────────────────────

/**
 * Fehlt einer dieser Ordner, gibt es eine Warnung mit `hinweis` und das Paket
 * wird trotzdem fertig. Ohne `rules/` blockt die Erweiterung nichts, laesst
 * sich aber laden und bedienen, genau das braucht man beim Bauen der
 * Oberflaeche, bevor die Listen einmal gezogen wurden.
 */
const BEIWERK = [
  { ordner: 'rules', muster: /\.json$/, hinweis: 'Ohne Regeln blockt nichts. `npm run listen:bauen` fahren.' },
  // Nur `.json`: Die Stylesheets schreibt `schreibeGenerischeCss()` unten aus
  // eben diesen JSON-Dateien. Kopiert wurden sie frueher zusaetzlich, und
  // damit auch `kosmetik/generisch.css` - die 222 kB grosse Vereinigung ALLER
  // Standardlisten, die zur Laufzeit niemand oeffnet (weder Manifest noch
  // Hintergrund nennen sie). Sie lag dreimal im Paket, einmal je Ziel, und ein
  // Store-Pruefer haette zu Recht gefragt, wofuer. Im Repo bleibt sie als
  // Momentaufnahme fuer Menschen liegen.
  { ordner: 'kosmetik', muster: /\.json$/, hinweis: 'Ohne Kosmetik bleiben leere Werbeflaechen stehen.' },
  { ordner: 'scriptlets', muster: /\.json$/, hinweis: 'Ohne Scriptlets fehlen die Gegenmittel gegen Adblock-Erkennung.' },
  { ordner: 'popup', muster: /\.json$/, hinweis: 'Ohne Popup-Hosts geht jeder Popunder auf. `npm run listen:bauen` fahren.' },
  { ordner: 'prozedural', muster: /\.json$/, hinweis: 'Ohne Textregeln bleiben Adblock-Overlays stehen. `npm run listen:bauen` fahren.' },
  { ordner: 'icons', muster: /\.(png|svg)$/, hinweis: 'Ohne Symbole zeigt der Browser einen grauen Platzhalter.' },
  // Die Attrappen fuer `$redirect`: leere Dateien, die eine geblockte
  // Anfrage BEANTWORTEN statt sie scheitern zu lassen. Fehlen sie, zeigt
  // jede Umleitungsregel ins Leere - Chrome laedt dann nichts, und die
  // Seite sieht denselben Fehler wie bei einem Block.
  { ordner: 'attrappen', muster: /\.(js|txt|css|html|gif|png)$/, hinweis: 'Ohne Attrappen wirken die $redirect-Regeln wie ein Block.' },
  // Die Sprachkataloge: Der HINTERGRUND liest sie als Paketdatei
  // (`hintergrund/texte.ts`), weil er `import.meta.glob` nicht hat. Die
  // Oberflaeche buendelt dieselben Dateien zusaetzlich - doppelt, aber die
  // Alternative waere, zwanzig Kataloge in den Service Worker zu legen.
  { ordner: 'i18n', muster: /\.json$/, hinweis: 'Ohne i18n/ bleibt die Verwechslungswarnung ohne Text.' },
  { ordner: 'phishing', muster: /\.json$/, hinweis: 'Ohne phishing/marken.json warnt der Verwechslungswarner nie.' },
  // NUR die beiden JSON-Dateien, NICHT `listen/quellen/`: Dort liegen die
  // rohen Filterlisten, zusammen ueber 20 MB, und niemand liest sie zur
  // Laufzeit.
  //
  // GEMESSEN am 03.09.2026 in Chrome for Testing 148 an der geladenen
  // Erweiterung: `sendMessage({typ:'zustand'})` gab fuer JEDE der zehn Listen
  // `regeln: null`. `ladeListenInfo()` holt die Regelzahlen aus
  // `listen/bericht.json`, und die Datei lag nicht im Paket - die Optionsseite
  // haette also nie eine Zahl neben einer Liste gezeigt. Stiller Fehler:
  // `holePaketJson()` gibt bei 404 `null` zurueck, und der Rueckfall auf
  // LISTEN_VORGABE traegt Namen und Premium-Kennzeichen, aber keine Zahlen.
  // Zweite Folge: `schalteRulesets()` rechnet mit `l.regeln ?? 0` und haette
  // das statische Regelkontingent nie als knapp erkannt.
  { ordner: 'listen', muster: /^(quellen|bericht)\.json$/, hinweis: 'Ohne listen/bericht.json steht neben keiner Liste eine Regelzahl.' },
];

/** Hoechstens so viele Selektoren je CSS-Regel, wie `scripts/listen-bauen.mjs` sie schreibt. */
const SELEKTOREN_JE_GRUPPE = 500;

// ── Hilfen ─────────────────────────────────────────────────────────────────

function kopiereDateien(vonOrdner, nachOrdner, muster) {
  if (!existsSync(vonOrdner)) return 0;
  const dateien = readdirSync(vonOrdner).filter((d) => (muster ? muster.test(d) : true));
  if (dateien.length === 0) return 0;
  mkdirSync(nachOrdner, { recursive: true });

  /*
   * Erst wegraeumen, was es in der Quelle nicht mehr gibt.
   *
   * ── Der Fund vom 14.09.2026 ───────────────────────────────────────────
   * `dist/firefox/i18n/` enthielt ZWANZIG Sprachkataloge, `i18n/` nur zehn.
   * Die anderen zehn (ar, fa, hi, id, ru, sv, th, tr, vi, zh) stammten aus
   * der Zeit, als das Projekt zwanzig Sprachen fuehrte. Kopiert wurde immer
   * nur daraufgelegt; entfernt hat nie jemand etwas, und `dist/` wird
   * zwischen zwei Baeufen nicht geleert (`emptyOutDir: false`, siehe Kopf).
   *
   * Sie gingen mit ins Store-Paket: zehn Dateien, die niemand mehr pflegt,
   * mit Texten auf dem Stand von damals. Gebuendelt werden sie nicht — die
   * Oberflaeche holt ihre Kataloge ueber `import.meta.glob` aus der QUELLE —,
   * aber der HINTERGRUND liest `i18n/<code>.json` als Paketdatei. Ein Nutzer
   * mit `sprache: 'ru'` haette dort einen Katalog gefunden, den es nicht mehr
   * geben soll.
   *
   * Geloescht wird nur, was auf DASSELBE Muster passt: Was ein anderer
   * Schritt in denselben Ordner schreibt (`kosmetik/*.generisch.css`,
   * `scriptlets/*.js`), traegt eine andere Endung und bleibt stehen.
   */
  const sollen = new Set(dateien);
  for (const vorhanden of readdirSync(nachOrdner)) {
    if (sollen.has(vorhanden)) continue;
    if (muster && !muster.test(vorhanden)) continue;
    rmSync(join(nachOrdner, vorhanden), { recursive: true, force: true });
  }

  for (const d of dateien) {
    const quelle = join(vonOrdner, d);
    if (statSync(quelle).isDirectory()) continue;
    cpSync(quelle, join(nachOrdner, d));
  }
  return dateien.length;
}

/**
 * `kosmetik/<id>.generisch.css` je Liste, abgeleitet aus dem `generisch`-Feld
 * von `kosmetik/<id>.json`.
 *
 * Warum hier und nicht in der Liste selbst: `src/hintergrund/regeln.ts`
 * meldet je AKTIVER Liste ein eigenes CSS-Inhaltsskript an
 * (`aktualisiereGenerischesCss`), damit „AdSilence aus" und eine Ausnahme je
 * Seite die generische Kosmetik wirklich abschalten. Ein `css`-Eintrag im
 * Manifest laesst sich weder abschalten noch je Host ausnehmen. Die
 * Vereinigungsdatei `kosmetik/generisch.css` bleibt daneben liegen; sie ist
 * die Momentaufnahme fuer den Menschen, nicht die Datei, die geladen wird.
 *
 * Kleine Gruppen, weil ein einziger ungueltiger Selektor seine ganze
 * CSS-Regel wirkungslos macht und in Filterlisten immer ein paar stehen.
 */
/**
 * Die eine Regel, die uns vor uns selbst schuetzt.
 *
 * GEMESSEN am 04.09.2026: Nach dem Einbau der Heimnetz-Liste erreichte die
 * Erweiterung ihr eigenes Backend nicht mehr. Die Liste blockt Zugriffe auf
 * 127.0.0.1 von dritter Seite - und der Service Worker der Erweiterung IST
 * dritte Seite. Die Listenpflege lief jeden Tag ins Leere, ohne Fehlermeldung,
 * die irgendwo angekommen waere.
 *
 * Lokal traf es 127.0.0.1. Live traefe es die eigene Domain, sobald sie in
 * IRGENDEINER der 32 Listen auftaucht - und die pflegen andere Leute. Dann
 * stuende die Erweiterung still, und niemand kaeme darauf, warum.
 *
 * Deshalb STATISCH und nicht dynamisch: Eine dynamische Regel wird erst beim
 * Start des Service Workers gesetzt, und was in dem Fenster davor faellt,
 * faellt eben. Prioritaet 5 liegt ueber allem, was aus Listen kommt
 * (Ausnahmen 3, `$important` 2, gewoehnlich 1).
 *
 * ── Warum es ZWEI Regeln sind und nicht eine ──────────────────────────────
 * Die erste Fassung nahm den eigenen Host KOMPLETT aus - auch fuer Anfragen,
 * die die eigene WEBSITE an sich selbst stellt. Das war zu viel: Der
 * Browsertest auf `/fingerabdruck-testen` fordert absichtlich Adressen an, die
 * wie Werbung und wie Zaehlpixel aussehen, und misst, ob sie ankommen. Mit der
 * pauschalen Ausnahme kamen sie IMMER an - die Seite haette jedem Nutzer
 * dieser Erweiterung „dein Browser blockt nichts" gemeldet.
 *
 *   1. `domainType: 'thirdParty'` - alles, was von AUSSEN an den eigenen Host
 *      geht. Dazu gehoert der Service Worker der Erweiterung selbst (sein
 *      Ursprung ist `chrome-extension://…`, also dritte Seite): genau der
 *      Fall vom 04.09.2026, um den es hier ueberhaupt geht.
 *   2. `||<host>/api/` OHNE Party-Einschraenkung - die Schnittstelle bleibt
 *      auch first-party frei. Die Website ruft `/api/plans`,
 *      `/api/translations` und den Kaufweg selbst auf; eine generische
 *      Listenregel, die dort zufaellig trifft, duerfte den Kauf nicht
 *      zerschiessen.
 *
 * Was damit NICHT mehr geschuetzt ist: first-party-Anfragen der eigenen
 * Website ausserhalb von `/api/`. Genau das ist gewollt - dort liegen die
 * Koeder (`/koeder/…`), und dort SOLL geblockt werden. Dass die uebrigen
 * Adressen der Seite von keiner Listenregel getroffen werden, prueft
 * `tests/rechenregeln/83` im Backend an den echten Regeldateien nach.
 */
function schreibeEigenschutz(aus, api) {
  const host = new URL(api).hostname;
  const regeln = [
    {
      id: 1,
      priority: 5,
      action: { type: 'allow' },
      condition: { urlFilter: `||${host}^`, domainType: 'thirdParty', isUrlFilterCaseSensitive: false },
    },
    {
      id: 2,
      priority: 5,
      action: { type: 'allow' },
      condition: { urlFilter: `||${host}/api/`, isUrlFilterCaseSensitive: false },
    },
  ];
  writeFileSync(join(aus, 'rules', 'eigenschutz.json'), JSON.stringify(regeln) + '\n');
}

/**
 * Der Rumpf des registrierten Scriptlet-Skripts — EINMAL uebersetzt, danach je
 * Liste mit ihrer Karte davor geschrieben.
 *
 * ── Warum registriert und nicht eingespritzt ─────────────────────────────
 * `executeScript` aus dem Service Worker ist ein Wettlauf gegen das erste
 * Seitenskript. GEMESSEN am 08.09.2026 in echtem Chrome
 * (`npm run probe:erkennung`): beim ersten Seitenskript stand die Falle NICHT,
 * nach 400 ms schon — kalt wie warm. Ein registriertes Inhaltsskript
 * injiziert der Browser selbst, ohne den Worker zu wecken.
 *
 * ── Warum der Rumpf nur einmal gebaut wird ───────────────────────────────
 * Er ist fuer alle Listen derselbe; nur die Karte unterscheidet sich. Zehnmal
 * dasselbe zu uebersetzen kostet zehnmal die Zeit und ergibt zehnmal
 * denselben Text.
 */
async function baueScriptletRumpf(esbuild, ziel) {
  const eingang = join(WURZEL, 'src', 'scriptlets', 'inhalt.ts');
  if (!existsSync(eingang)) return null;
  const ergebnis = await esbuild.build({
    entryPoints: [eingang],
    bundle: true,
    // `iife`: ein Inhaltsskript ist kein Modul. Ein `import` gaebe einen
    // Fehler in der Konsole jeder besuchten Seite.
    format: 'iife',
    target: ZIELVERSIONEN,
    platform: 'browser',
    define: definitionen(ziel),
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'warning',
    // Nicht auf die Platte, sondern in den Speicher: Der Text wird gleich
    // zehnmal mit verschiedenen Karten davor geschrieben.
    write: false,
  });
  const datei = ergebnis.outputFiles && ergebnis.outputFiles[0];
  return datei ? datei.text : null;
}

/**
 * `scriptlets/<id>.js` je Liste: die Host-Karte als JSON-TEXT, dann der Rumpf.
 *
 * Die Karte steht als String und nicht als Objektliteral, und das ist der
 * ganze Trick: `ublock.json` ist 211 kB. Als Literal muesste die
 * JavaScript-Maschine das auf JEDER Seite parsen — auch auf den 99 von 100,
 * fuer die kein einziger Eintrag gilt. Als String kostet es fast nichts: Der
 * Rumpf prueft mit ein paar `indexOf`, ob ueberhaupt etwas fuer diesen Host
 * da ist, und ruft `JSON.parse` nur dann.
 *
 * `JSON.stringify` ueber den gelesenen Text erzeugt ein gueltiges
 * JS-String-Literal samt Maskierung — von Hand zusammengesetzte
 * Anfuehrungszeichen waeren die uebliche Stelle, an der ein Apostroph in einem
 * Hostnamen die Datei zerreisst.
 */
function schreibeScriptletSkripte(aus, rumpf, warnungen) {
  if (!rumpf) {
    warnungen.push('src/scriptlets/inhalt.ts fehlt; Scriptlets laufen nur ueber den Rueckfall.');
    return 0;
  }
  const quelle = join(WURZEL, 'scriptlets');
  if (!existsSync(quelle)) return 0;
  let geschrieben = 0;
  for (const datei of readdirSync(quelle)) {
    if (!datei.endsWith('.json')) continue;
    const id = datei.slice(0, -'.json'.length);
    const roh = readFileSync(join(quelle, datei), 'utf8').trim();
    if (!roh || roh === '{}') continue;
    try {
      JSON.parse(roh);
    } catch (e) {
      warnungen.push(`scriptlets/${datei} ist kein gueltiges JSON (${fehlerText(e)}); uebersprungen.`);
      continue;
    }
    mkdirSync(join(aus, 'scriptlets'), { recursive: true });
    writeFileSync(
      join(aus, 'scriptlets', `${id}.js`),
      `var __ADSILENCE_KARTE = ${JSON.stringify(roh)};\n${rumpf}`,
    );
    geschrieben += 1;
  }
  return geschrieben;
}

function schreibeGenerischeCss(aus, warnungen) {
  const quelle = join(WURZEL, 'kosmetik');
  if (!existsSync(quelle)) return 0;
  let geschrieben = 0;
  for (const datei of readdirSync(quelle)) {
    if (!datei.endsWith('.json')) continue;
    const id = datei.slice(0, -'.json'.length);
    let inhalt;
    try {
      inhalt = JSON.parse(readFileSync(join(quelle, datei), 'utf8'));
    } catch (e) {
      warnungen.push(`kosmetik/${datei} ist kein gueltiges JSON (${e instanceof Error ? e.message : e}); uebersprungen.`);
      continue;
    }
    const selektoren = Array.isArray(inhalt?.generisch) ? inhalt.generisch : [];
    const sauber = selektoren.filter((s) => typeof s === 'string' && s.length > 0 && !s.includes('{') && !s.includes('}'));
    if (sauber.length === 0) continue;
    const gruppen = [];
    for (let i = 0; i < sauber.length; i += SELEKTOREN_JE_GRUPPE) {
      gruppen.push(`${sauber.slice(i, i + SELEKTOREN_JE_GRUPPE).join(',\n')}{display:none!important}`);
    }
    mkdirSync(join(aus, 'kosmetik'), { recursive: true });
    writeFileSync(join(aus, 'kosmetik', `${id}.generisch.css`), gruppen.join('\n') + '\n');
    geschrieben += 1;
  }
  return geschrieben;
}

/**
 * `_locales` aus `i18n/` erzeugen lassen (gehoert der Oberflaeche).
 *
 * JEDES Mal, nicht nur wenn der Ordner fehlt. Genau daran ist es schon
 * vorbeigelaufen: `_locales` trug `de` und `en` aus der Zeit, als es nur diese
 * zwei Kataloge gab; die spaeter dazugekommenen achtzehn Sprachen erzeugten
 * keinen Ordner mehr, weil `_locales` ja "da" war. Ausgeliefert wurde ein
 * Store-Eintrag, der in achtzehn Sprachen auf `default_locale` zurueckfiel.
 * Dieselbe Ursache traf den Beobachtungsbetrieb: Der Watcher unten horcht auf
 * `i18n/`, das Ergebnis blieb wegen derselben Abkuerzung trotzdem stehen.
 *
 * Der Preis ist ein Node-Start je Bauvorgang fuer zwanzig winzige Dateien.
 */
function stelleLocalesBereit(warnungen) {
  const ordner = join(WURZEL, '_locales');
  const skript = join(WURZEL, 'scripts', 'locales.mjs');
  const daUndGefuellt = () => existsSync(ordner) && readdirSync(ordner).length > 0;

  if (!existsSync(skript)) {
    if (daUndGefuellt()) return true;
    warnungen.push('`_locales` fehlt und `scripts/locales.mjs` gibt es nicht. Name und Beschreibung bleiben im Store leer.');
    return false;
  }
  // Nur die Fehlerausgabe durchreichen: Bei `--ziel=alle` staende die
  // Erfolgsmeldung sonst dreimal untereinander und verdeckte die Warnungen,
  // auf die es ankommt.
  const lauf = spawnSync(process.execPath, [skript], { cwd: WURZEL, stdio: ['ignore', 'ignore', 'inherit'] });
  if (lauf.status !== 0) {
    // Nicht `false`: Ein alter Stand im Paket ist besser als gar keiner. Ohne
    // `_locales` traegt das Manifest `__MSG_extName__` als Namen, und der
    // Browser lehnt es ab.
    warnungen.push('`node scripts/locales.mjs` ist fehlgeschlagen; es gilt weiter der letzte Stand von `_locales`.');
  }
  return daUndGefuellt();
}

function zaehleOrdner(ordner) {
  let dateien = 0;
  let bytes = 0;
  const lauf = (p) => {
    for (const eintrag of readdirSync(p, { withFileTypes: true })) {
      const voll = join(p, eintrag.name);
      if (eintrag.isDirectory()) lauf(voll);
      else {
        dateien += 1;
        bytes += statSync(voll).size;
      }
    }
  };
  if (existsSync(ordner)) lauf(ordner);
  return { dateien, bytes };
}

function alsGroesse(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fehlerText(e) {
  if (e && Array.isArray(e.errors) && e.errors.length) {
    return e.errors.map((f) => `${f.location?.file ?? '?'}:${f.location?.line ?? '?'} ${f.text}`).join('\n           ');
  }
  return e instanceof Error ? e.message : String(e);
}

// ── Die drei Schritte ──────────────────────────────────────────────────────

/** Schritt 1: esbuild. Gibt die Kontexte zurueck, falls beobachtet wird. */
async function baueSkripte(esbuild, ziel, aus, warnungen) {
  const kontexte = [];
  for (const buendel of BUENDEL) {
    if (!existsSync(join(WURZEL, buendel.eingang))) {
      warnungen.push(`${buendel.eingang} fehlt; ${buendel.ausgang} bleibt aus dem Paket.`);
      continue;
    }
    const optionen = esbuildOptionen(ziel, buendel, aus);
    if (beobachten) {
      const kontext = await esbuild.context(optionen);
      await kontext.watch();
      kontexte.push(kontext);
    } else {
      await esbuild.build(optionen);
    }
  }
  return kontexte;
}

/** Schritt 2: Vite. Gibt den Watcher zurueck, falls beobachtet wird. */
async function baueSeiten(ziel, aus, warnungen) {
  const konfig = join(WURZEL, 'vite.config.ts');
  if (!existsSync(konfig)) {
    warnungen.push('vite.config.ts fehlt; Popup und Optionsseite bleiben aus dem Paket.');
    return null;
  }
  if (!existsSync(join(WURZEL, 'src', 'popup', 'index.html')) || !existsSync(join(WURZEL, 'src', 'optionen', 'index.html'))) {
    warnungen.push('src/popup/index.html oder src/optionen/index.html fehlt; die Seiten bleiben aus dem Paket.');
    return null;
  }
  let vite;
  try {
    vite = await import('vite');
  } catch {
    warnungen.push('Vite ist nicht installiert (`npm install`); Popup und Optionsseite bleiben aus dem Paket.');
    return null;
  }

  // vite.config.ts liest diese drei, so gibt es nur EINE Stelle, an der
  // Ziel, Adresse und Version stehen, und `npx vite build` funktioniert auch
  // ohne dieses Skript.
  process.env.ADSILENCE_ZIEL = ziel;
  process.env.ADSILENCE_API = API;
  process.env.ADSILENCE_VERSION = VERSION;

  // `outDir` steht auch in `vite.config.ts` (damit `npx vite build` allein
  // funktioniert), aber `--aus=` muss beide Haelften des Baus verschieben.
  // Sonst schreibt esbuild in den gewuenschten Ordner und Vite weiter nach
  // `dist/`, und das Ergebnis ist ein Paket ohne Popup, das dennoch geladen
  // werden kann. Gemessen: Beim ersten Versuch fehlten Popup, Optionsseite und
  // deren Bausteine im Zielordner, ohne eine einzige Warnung.
  const inline = { configFile: konfig, logLevel: 'warn', build: { outDir: aus } };
  if (beobachten) inline.build.watch = {};
  const ergebnis = await vite.build(inline);
  if (!beobachten) return null;

  // `vite.build` mit `watch` kehrt zurueck, SOBALD der Beobachter steht, nicht
  // wenn der erste Lauf fertig ist. Ohne dieses Warten zaehlt die Zeile am
  // Ende Dateien, die es noch nicht gibt, und wer sofort neu laedt, sieht ein
  // Paket ohne Popup.
  await new Promise((fertig) => {
    let erledigt = false;
    const einmal = () => {
      if (erledigt) return;
      erledigt = true;
      fertig();
    };
    ergebnis.on('event', (e) => {
      if (e.code === 'END' || e.code === 'ERROR') einmal();
    });
    // Wenn Vite die Ereignisse nicht liefert, soll das Bauskript nicht haengen.
    setTimeout(einmal, 60_000).unref?.();
  });
  return ergebnis;
}

/** Schritt 3 und 4: Beiwerk kopieren, Manifest schreiben. */
function baueBeiwerk(ziel, aus, warnungen, scriptletRumpf) {
  for (const teil of BEIWERK) {
    const anzahl = kopiereDateien(join(WURZEL, teil.ordner), join(aus, teil.ordner), teil.muster);
    if (anzahl === 0) warnungen.push(`${teil.ordner}/ ist leer oder fehlt. ${teil.hinweis}`);
  }

  schreibeGenerischeCss(aus, warnungen);
  schreibeScriptletSkripte(aus, scriptletRumpf, warnungen);
  schreibeEigenschutz(aus, API);

  if (stelleLocalesBereit(warnungen)) {
    cpSync(join(WURZEL, '_locales'), join(aus, '_locales'), { recursive: true });
  }

  for (const w of schreibeManifest(ziel, aus)) warnungen.push(w);
}

// ── Lauf ───────────────────────────────────────────────────────────────────

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error('build: esbuild ist nicht installiert. `npm install` im Ordner extension/.');
  process.exit(1);
}

let fehlgeschlagen = 0;
const offen = [];
/*
 * Je Ziel der uebersetzte Rumpf des Scriptlet-Skripts. Er haengt am Ziel, weil
 * `definitionen(ziel)` hineinkompiliert wird; und er wird gemerkt, damit der
 * Beobachtungslauf ihn nicht bei jeder Dateiaenderung neu uebersetzen muss.
 */
const scriptletRuempfe = {};

for (const ziel of ziele) {
  const aus = join(ausWurzel, ziel);
  const warnungen = [];

  /*
   * Ein einmaliger Bau faengt bei LEER an.
   *
   * ── GEMESSEN am 14.09.2026 ──────────────────────────────────────────────
   * Das eingereichte Firefox-Paket hatte 265 Dateien. Derselbe Quelltext,
   * ausgepackt in einem frischen Ordner und gebaut, ergab 254. Die elf
   * Ueberzaehligen waren Altlasten: zehn `_locales/<code>/messages.json` aus
   * der Zeit, als das Projekt zwanzig Sprachen fuehrte, und
   * `kosmetik/sozial.generisch.css` zu einer Liste, die es nicht mehr gibt.
   * Jeder Bau legte nur drauf; entfernt hat nie jemand etwas.
   *
   * Fuer die AMO-Pruefung ist das der schlimmste Fall: Der Pruefer baut aus
   * dem beigelegten Quelltext und bekommt ein ANDERES Paket als das
   * eingereichte — „laesst sich nicht reproduzieren" ist ein Ablehnungsgrund.
   * Und die elf Dateien gingen an jeden Nutzer mit aus.
   *
   * Ein einzelner Ordner je Ziel wegzuraeumen greift dabei zu kurz: Das
   * Problem ist nicht ein Ordner, sondern dass ueberhaupt etwas liegen
   * bleibt, und der naechste Fall waere wieder ein anderer.
   *
   * Beim BEOBACHTEN wird nicht geleert: Dort laufen esbuild und Vite weiter
   * und schreiben einzelne Dateien nach; ein Wegraeumen mittendrin nimmt
   * ihnen den Ordner unter den Fuessen weg.
   */
  if (!beobachten) rmSync(aus, { recursive: true, force: true });

  mkdirSync(aus, { recursive: true });

  // `_metadata/` gehoert nicht uns: Chrome legt es an, sobald der Ordner
  // einmal als entpackte Erweiterung geladen war (vorkompilierte Regelindizes,
  // gemessen: 10 Dateien, 5,5 MB). Nach einem Neubau passen diese Indizes
  // nicht mehr zu den Regeln daneben - die geladene Erweiterung steht dann in
  // `chrome://extensions` als kaputt da, mit einem leeren Symbol in der
  // Leiste. GEMESSEN am 09.09.2026, nachdem mehrere Proben den Ordner geladen
  // und der naechste Bau die Regeln ersetzt hatte.
  //
  // Der Name ist ausserdem im Store reserviert; `zip.mjs` schliesst ihn beim
  // Packen ohnehin aus. Hier faellt er VOR dem Bau, damit der Ordner nach
  // jedem Lauf wieder ladbar ist.
  rmSync(join(aus, '_metadata'), { recursive: true, force: true });

  try {
    offen.push(...(await baueSkripte(esbuild, ziel, aus, warnungen)));
    const watcher = await baueSeiten(ziel, aus, warnungen);
    if (watcher) offen.push(watcher);
    scriptletRuempfe[ziel] = await baueScriptletRumpf(esbuild, ziel);
    baueBeiwerk(ziel, aus, warnungen, scriptletRuempfe[ziel]);
  } catch (e) {
    console.error(`[build ${ziel}] FEHLER: ${fehlerText(e)}`);
    fehlgeschlagen += 1;
    continue;
  }

  for (const w of warnungen) console.warn(`[build ${ziel}] Warnung: ${w}`);
  const { dateien, bytes } = zaehleOrdner(aus);
  // Ein Pfad mit fuenf `..` davor ist keine Hilfe; dann lieber der ganze.
  const kurz = relative(WURZEL, aus);
  const anzeige = kurz && !kurz.startsWith('..') ? kurz : aus;
  console.log(`[build ${ziel}] ${anzeige}: ${dateien} Dateien, ${alsGroesse(bytes)}`);
}

/** Ordner, deren Inhalt nur kopiert wird und den darum niemand sonst beobachtet. */
const BEIWERK_ORDNER = ['manifest', 'rules', 'kosmetik', 'scriptlets', 'popup', 'prozedural', 'icons', 'i18n'];

/**
 * Fingerabdruck ueber diese Ordner: Name, Groesse und Zeitstempel jeder Datei.
 *
 * Warum Abtasten und nicht `fs.watch`: Ein Ordner-Watcher meldet auf macOS
 * nicht zuverlaessig, wenn sich der INHALT einer vorhandenen Datei aendert.
 * Gemessen in genau dieser Umgebung: drei aufeinanderfolgende Schreibvorgaenge
 * an `manifest/base.json`, kein einziges Ereignis, weder flach noch rekursiv.
 * Ein Wachhund, der genau dann schweigt, wenn etwas passiert, ist schlimmer
 * als keiner, denn man verlaesst sich auf ihn. Eine Sekunde `stat` ueber rund
 * zwanzig Dateien kostet nichts und funktioniert ueberall gleich.
 */
function fingerabdruck() {
  let text = '';
  for (const ordner of BEIWERK_ORDNER) {
    const pfad = join(WURZEL, ordner);
    if (!existsSync(pfad)) continue;
    for (const name of readdirSync(pfad).sort()) {
      try {
        const s = statSync(join(pfad, name));
        if (s.isDirectory()) continue;
        text += `${ordner}/${name}:${s.size}:${s.mtimeMs};`;
      } catch {
        // Datei genau jetzt weggeraeumt; der naechste Durchlauf sieht es.
      }
    }
  }
  return text;
}

if (beobachten && offen.length > 0) {
  console.log(`[build] beobachte ${ziele.join(', ')}, Strg-C beendet.`);
  // Quelltext beobachten esbuild und Vite selbst; hier geht es nur um das
  // Beiwerk und das Manifest.
  let letzter = fingerabdruck();
  setInterval(() => {
    const jetzt = fingerabdruck();
    if (jetzt === letzter) return;
    letzter = jetzt;
    for (const ziel of ziele) {
      const warnungen = [];
      try {
        baueBeiwerk(ziel, join(ausWurzel, ziel), warnungen, scriptletRuempfe[ziel]);
        console.log(`[build ${ziel}] Beiwerk und Manifest neu geschrieben.`);
      } catch (e) {
        console.error(`[build ${ziel}] ${fehlerText(e)}`);
      }
    }
  }, 1000);
} else if (fehlgeschlagen > 0) {
  process.exit(1);
}
