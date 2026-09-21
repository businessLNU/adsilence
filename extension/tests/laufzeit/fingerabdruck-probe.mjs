#!/usr/bin/env node
/**
 * Der Beweis fuer „Fingerabdruck verwischen": Rauscht die gebaute Erweiterung
 * dort, wo sie soll, und NUR dort, faellt es keinem Luegendetektor auf - und
 * meldet Cover Your Tracks den Browser als „randomized"?
 *
 *     npm run probe:fingerabdruck
 *     npm run probe:fingerabdruck -- --eff     # zusaetzlich Cover Your Tracks
 *
 * Rueckgabe 0 nur, wenn alle Messreihen bestehen. Mit `--eff` gehoert die
 * Reihe (5) dazu: Sie besteht NUR, wenn im Kernsatz von Cover Your Tracks
 * „randomized" steht („Your browser fingerprint has been randomized").
 *
 * ── Was Cover Your Tracks wirklich zaehlt ─────────────────────────────────
 * Gemessen am Quelltext (EFForg/panopticlick, static/fetch_whorls.js,
 * templates/ajax_fingerprint.html, Stand 05.09.2026): CYT misst fuenf Werte
 * (audio, canvas_hash_v2, webgl_hash_v2, plugins, hardware_concurrency)
 * ZWEIMAL - einmal auf firstpartysimulator.net, einmal auf der eigenen
 * Domain - und zaehlt je Wert einen Punkt, wenn er sich ZWISCHEN den beiden
 * Domains unterscheidet. Ab vier Punkten heisst es „has been randomized".
 * Ein Unterschied INNERHALB einer Seite (zwei Canvases, zwei Hashes) macht
 * den Wert auf beiden Domains zum Text „randomized", und zwei gleiche Texte
 * sind kein Unterschied: kein Punkt. Deshalb misst diese Probe dieselbe
 * Seite unter ZWEI Hostnamen, 127.0.0.1 und localhost, und zaehlt die fuenf
 * Werte lokal nach, so wie CYT es tut - vor dem Lauf gegen CYT selbst.
 *
 * ── Warum eine eigene Testseite und kein FingerprintJS ────────────────────
 * Die Seite unter `tests/fingerabdruck/index.html` malt dasselbe Bild wie
 * FingerprintJS (Text mit Emoji, Verlauf, Boegen mit evenodd-Winding), das
 * WebGL-Dreieck von FingerprintJS2, rechnet dieselbe Audiosumme und
 * serialisiert die Plugins mit dem `identify_plugins` von CYT - laedt aber
 * nichts aus dem Netz. Das ist keine Sparsamkeit: Die Fingerprint-CDNs
 * stehen in EasyPrivacy, die Erweiterung selbst wuerde die Bibliothek
 * blocken, und die Probe misst dann ihren eigenen Netzfilter statt das
 * Rauschen. Was die fremde Seite sagt, misst Schritt (5) an Cover Your
 * Tracks, mit `--eff`.
 *
 * ── Warum der erste Lauf OHNE Erweiterung ist ─────────────────────────────
 * „Hash ungleich Grundwert" braucht einen Grundwert, und der ist nur dann
 * einer, wenn er aus DEMSELBEN Chrome auf DEMSELBEN Rechner kommt: Die
 * Schriftdarstellung, die die Entropie liefert, ist von Maschine zu Maschine
 * verschieden. Aus dem Grundlauf kommen ausserdem die toString-Texte (die
 * Huellen muessen sie buchstabengetreu wiedergeben), die Pixel der Bruchprobe
 * (Abweichung hoechstens 1), die Kosten (das Verhaeltnis rechtfertigt
 * PIXEL_BUDGET, oder es tut es nicht), die echten Plugin-Namen (kein echter
 * Eintrag darf fehlen, und der erfundene ist der, den es dort nicht gab)
 * und die WebGL-Pixel (readPixels muss bitgleich bleiben).
 *
 * ── Warum zwei Profile ────────────────────────────────────────────────────
 * Das Sitzungs-Token lebt in storage.session. Zwei Tabs desselben Profils
 * auf derselben obersten Seite muessen dieselben Werte liefern (sonst ist
 * die Bindung an die Seite kaputt), zwei Profile verschiedene (sonst ist das
 * Rauschen dauerhaft und damit selbst ein Wiedererkennungsmerkmal).
 *
 * ── Was hier BEKANNT ist und nicht als Fehler zaehlt ──────────────────────
 * `ctx.getImageData({ valueOf() { new Error().stack } }, 0, 1, 1)` traegt im
 * Stack die Erweiterungs-ID. Die Typumwandlung laeuft im nativen Aufruf, der
 * auf dem Rahmen der Huelle steht; kein Umbau hilft. Ebenso: das native
 * `toString` eines SYNCHRON nach appendChild gelesenen about:blank-Rahmens
 * (Chrome injiziert dort asynchron), der Prototyp eines fertigen Rahmens,
 * angewandt auf ein Canvas des Elternfensters (Buchfuehrung je Realm), und
 * `PluginArray.prototype.item.call(navigator.plugins, 0)`: Ein Proxy ist
 * kein Plattformobjekt, die native Methode WUERDE darauf „Illegal invocation"
 * werfen - die Erweiterung faengt das aber mit Huellen auf den Prototypen ab
 * (GEMESSEN 05.09.2026: kein Fehler, wie ohne Erweiterung). Die Probe misst
 * alles vier und berichtet es als BEKANNT bzw. INFO, damit niemand es fuer
 * neu haelt - und damit auffaellt, wenn der Aufruf je wieder wirft.
 *
 * ── Was auf manchen Rechnern nichts beweist ───────────────────────────────
 * `deviceMemory` deckelt Chrome nativ bei 8, und ein Rechner mit zwei, vier
 * oder acht Kernen meldet nativ einen Wert aus der Menge, die die
 * Erweiterung je Site waehlt. Dort waere die Zeile gruen, auch wenn der
 * Getter nie eingehuellt wuerde. Die Probe vergleicht deshalb erst den
 * Grundwert mit dem Sollwert und berichtet INFO „nicht unterscheidbar",
 * statt OK zu sagen. Ob 127.0.0.1 und localhost verschiedene Kernzahlen
 * bekommen, ist bei drei moeglichen Werten Wahrscheinlichkeit (zwei von
 * drei), keine Garantie; die Probe berichtet es als INFO, nie als FEHL.
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright ist ABSICHTLICH keine Abhaengigkeit dieses Pakets (siehe
// koeder-probe.mjs): dynamischer Import mit Ansage statt ERR_MODULE_NOT_FOUND.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Diese Probe braucht Playwright. Einmalig einrichten:\n');
  console.error('  npm install --no-save playwright');
  console.error('  npx playwright install chromium\n');
  console.error('Danach: npm run probe:fingerabdruck');
  process.exit(2);
}

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..', '..');
const ERWEITERUNG = resolve(
  process.argv.find((a) => !a.startsWith('--') && a.endsWith('chromium')) ?? join(WURZEL, 'dist', 'chromium'),
);
const MIT_EFF = process.argv.includes('--eff');

if (!existsSync(join(ERWEITERUNG, 'manifest.json'))) {
  console.error(`${ERWEITERUNG} fehlt oder hat kein manifest.json.`);
  console.error('Erst `npm run build`, dann diese Probe.');
  process.exit(1);
}
if (!existsSync(join(ERWEITERUNG, 'inhalt', 'fingerabdruck.js'))) {
  console.error(`${join(ERWEITERUNG, 'inhalt', 'fingerabdruck.js')} fehlt.`);
  console.error('Das Paket ist ohne das Hauptwelt-Skript gebaut; erst `npm run build` mit dem aktuellen Stand.');
  process.exit(1);
}

/** Dieselbe Zeile wie in den uebrigen Proben: Chrome for Testing, nicht Chrome. */
const CHROME =
  process.env.ADSILENCE_CHROME ??
  process.env.CHROME_PFAD ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

/** Wohin Bericht und Bildschirmfotos kommen: ein Ordner je Lauf, in .gitignore. */
const BELEGE = join(WURZEL, '.fingerabdruck', new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));

const CYT = 'https://coveryourtracks.eff.org/';

/**
 * Die zwei Hosts der Testseite. Beides sind oberste Seiten, beides sichere
 * Kontexte (nur dort verhaelt sich der Browser wie auf einer echten Seite:
 * OffscreenCanvas, Blob-URLs, crypto), und fuer die Erweiterung sind es
 * ZWEI VERSCHIEDENE SITES - der Seed haengt am Hostnamen, nicht an der
 * Adresse. Genau das braucht die Nachzaehlung wie CYT: dieselbe Seite,
 * zwei Domains, fuenf Werte. Ein erfundener Name ueber host-resolver-rules
 * ist nicht noetig. Fuer die Ausnahme in Schritt (4) ist 127.0.0.1 der
 * Schluessel im `sites`-Speicher der Erweiterung; localhost bleibt dort
 * ungenannt und muss weiter rauschen.
 */
const HOST = '127.0.0.1';
const HOST_ZWEI = 'localhost';

/** Die Kernzahlen, die die Erweiterung je Site waehlt (Vertrag, Punkt 3). */
const KERNE_MENGE = [2, 4, 8];

/**
 * Was im erfundenen Plugin nicht vorkommen darf: Erkennungscode fuer diese
 * Plugins (PluginDetect, die Flash- und PDF-Weichen alter Seiten) faende
 * sonst etwas, das es nicht gibt, und nutzte es.
 */
const VERBOTEN_IM_PLUGIN = /pdf|flash|java|silverlight|quicktime|shockwave|vlc|media|widevine/i;

// ── Server ─────────────────────────────────────────────────────────────────

const seiteHtml = readFileSync(join(HIER, '..', 'fingerabdruck', 'index.html'), 'utf8');
const antworte = (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(seiteHtml);
};
const server = createServer(antworte);
const port = await new Promise((fertig) => {
  server.listen(0, HOST, () => fertig(server.address().port));
});
/**
 * Zweiter Lauscher auf `::1`, derselbe Port. Chrome loest `localhost`
 * selbst auf Loopback auf und versucht IPv6 zuerst; scheitert das, faellt
 * es auf 127.0.0.1 zurueck, wo der erste Lauscher steht. Der zweite ist
 * also Bequemlichkeit (kein Umweg ueber einen abgewiesenen Verbindungs-
 * versuch), keine Notwendigkeit - deshalb scheitert er leise, wenn der
 * Rechner kein IPv6-Loopback hat oder der Port dort belegt ist.
 */
const serverSechs = createServer(antworte);
await new Promise((fertig) => {
  serverSechs.once('error', () => fertig());
  serverSechs.listen(port, '::1', () => fertig());
});
const seiteUrl = (host) => `http://${host}:${port}/`;
const SEITE = seiteUrl(HOST);

// ── Proben ─────────────────────────────────────────────────────────────────

const proben = [];
/** Eine Probe: Name, ob sie bestanden ist, und was gemessen wurde. */
const pruefe = (reihe, name, gut, gemessen) => proben.push({ reihe, name, gut: Boolean(gut), gemessen: String(gemessen) });
const bekannt = (reihe, name, gemessen) => proben.push({ reihe, name, gut: true, bekannt: true, gemessen: String(gemessen) });

// ── Browser ────────────────────────────────────────────────────────────────

/**
 * Ein frisches Wegwerfprofil je Aufruf (`launchPersistentContext('')`). Mit
 * Erweiterung fallen Playwrights eigene `--disable-extensions`-Schalter weg,
 * sonst laedt `--load-extension` nichts.
 */
async function starte(mitErweiterung) {
  const args = ['--no-first-run', '--no-default-browser-check'];
  const opts = { executablePath: CHROME, headless: false, args };
  if (mitErweiterung) {
    opts.ignoreDefaultArgs = ['--disable-extensions', '--disable-component-extensions-with-background-pages'];
    args.unshift(`--disable-extensions-except=${ERWEITERUNG}`, `--load-extension=${ERWEITERUNG}`);
  }
  const browser = await chromium.launchPersistentContext('', opts);
  let kennung = null;
  if (mitErweiterung) {
    const arbeiter =
      browser.serviceWorkers()[0] ??
      (await browser.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null));
    if (!arbeiter) throw new Error('Der Service Worker der Erweiterung ist nicht gestartet.');
    kennung = new URL(arbeiter.url()).host;
    // Regeln und Sitzungs-Token brauchen einen Moment.
    await new Promise((f) => setTimeout(f, 2500));
  }
  return { browser, kennung };
}

/**
 * Die Testseite oeffnen, WARTEN, dann messen.
 *
 * Die Wartezeit ist kein Ratewert: Das Sitzungs-Token kommt ueber
 * Inhaltsskript → Hintergrund → CustomEvent in die Hauptwelt. Wer vorher
 * ein Canvas anfasst, bekommt einen zufaelligen Seed fuer die Lebensdauer der
 * Seite, und die Sitzungsbindung liesse sich nicht mehr messen. Die Seite
 * selbst tut deshalb beim Laden nichts (siehe dort).
 */
async function messeSeite(browser, optionen = {}, abfrage = '', host = HOST) {
  const seite = await browser.newPage();
  await seite.goto(seiteUrl(host) + abfrage, { waitUntil: 'load' });
  await seite.waitForTimeout(1500);
  const ergebnis = await seite.evaluate((o) => window.__messe(o), optionen);
  return { seite, ergebnis };
}

/**
 * Schritt (4): die Testseite als Ausnahme eintragen, so wie das Popup es tut.
 *
 * Ueber die Nachricht `site.setzen` aus einer Seite der Erweiterung heraus
 * (der Hintergrund nimmt sie nur von der eigenen Oberflaeche an) und nicht
 * ueber ein direktes `storage.local.set`: Die Nachricht zieht auch die
 * dynamischen DNR-Regeln nach, so wie es beim Kunden passiert. Faellt die
 * Nachricht aus, wird als Rueckfall direkt geschrieben, und das steht dann im
 * Bericht.
 */
async function ausnahmeSetzen(browser, kennung, host) {
  const seite = await browser.newPage();
  await seite.goto(`chrome-extension://${kennung}/optionen/index.html`);
  await seite.waitForTimeout(800);
  const weg = await seite.evaluate(async (h) => {
    try {
      const antwort = await chrome.runtime.sendMessage({ typ: 'site.setzen', host: h, erlaubt: true });
      if (antwort && antwort.ok) return 'nachricht';
    } catch {
      /* dann der Rueckfall */
    }
    const { sites } = await chrome.storage.local.get('sites');
    await chrome.storage.local.set({ sites: { ...(sites ?? {}), [h]: { erlaubt: true, seit: Date.now() } } });
    return 'storage.local';
  }, host);
  const eingetragen = await seite.evaluate(async (h) => {
    const { sites } = await chrome.storage.local.get('sites');
    return Boolean(sites && sites[h] && sites[h].erlaubt === true);
  }, host);
  await seite.close();
  // Der Hintergrund braucht einen Moment, bis die Regeln stehen.
  await new Promise((f) => setTimeout(f, 1000));
  return { weg, eingetragen };
}

/**
 * Schritt (5): Cover Your Tracks.
 *
 * Geklickt wird der Link auf `/kcarter` (der Knopf „Test Your Browser"),
 * NICHT der erste Textfund von „test your browser": Das ist auf der
 * Startseite ein Absatz, kein Link, und ein Klick darauf tut nichts.
 * GEMESSEN 05.09.2026: Der Lauf ohne Erweiterung wartete drei Minuten auf
 * eine Ergebnisseite, die nie kam. Danach laeuft CYT ueber zwei
 * firstpartysimulator-Hosts und landet auf `/results`; die drei Minuten sind
 * ein Deckel, kein Ratewert, gemessen dauert es etwa dreissig Sekunden.
 *
 * Gelesen wird zweierlei, und beides steht im Bericht:
 *
 * - `whorls`: die Messwerte aus dem Parameter `fpi_whorls` der Ergebnis-URL.
 *   Das sind die Werte, die CYTs Skript auf firstpartysimulator.net gemessen
 *   hat - `canvas_hash_v2`, `webgl_hash_v2`, `audio`, `plugins`,
 *   `hardware_concurrency`. Ein Wert ist dort der Text „randomized", wenn
 *   zwei Laeufe auf DERSELBEN Domain verschieden waren (das zaehlt bei CYT
 *   nichts, siehe Kopf).
 * - `zeilen`: der Text der Ergebnisseite. Dort steht je Merkmal die
 *   ENTSCHEIDUNG von CYT: ein Hash, oder „randomized by first party domain"
 *   (bei hardware concurrency nur „randomized"), wenn sich der Wert zwischen
 *   den beiden Domains unterschied. DAS sind die Punkte; die Probe zaehlt
 *   sie in `punkte` nach.
 *
 * Der Kernsatz („Your browser fingerprint has been randomized" ab vier
 * Punkten, sonst „appears to be unique" bzw. die Tabellenzeile „Your browser
 * has a nearly-unique fingerprint") wird zuerst aus `#fp_status` gelesen,
 * sonst aus dem Text. Die Ergebnisseite ist keine Tabelle mehr, sondern
 * Ueberschrift und Wert untereinander („HASH OF CANVAS FINGERPRINT",
 * naechste Zeile der Wert); ein Griff nach `tr` fand nichts (GEMESSEN
 * 05.09.2026).
 */
async function coverYourTracks(browser, name) {
  const seite = await browser.newPage();
  const aus = { name, urteil: null, kernsatz: null, status: null, zeilen: {}, whorls: null, punkte: null, fehler: null };
  try {
    await seite.goto(CYT, { waitUntil: 'load', timeout: 60000 });
    const link = seite.locator('a[href*="kcarter"]').first();
    if (await link.count()) {
      await link.click({ timeout: 20000 });
    } else {
      await seite.getByRole('link', { name: /test your browser/i }).first().click({ timeout: 20000 });
    }
    await seite.waitForURL(/\/results/, { timeout: 180000 });
    await seite.waitForFunction(() => /hash of canvas fingerprint/i.test(document.body.innerText), null, { timeout: 60000 });
    await seite.waitForTimeout(3000);
    // Die volle Liste steht hinter einem Aufklapper.
    for (const text of [/show full results/i, /detailed view/i]) {
      await seite
        .getByText(text)
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
    }
    await seite.waitForTimeout(1500);
    try {
      const roh = new URL(seite.url()).searchParams.get('fpi_whorls');
      if (roh) aus.whorls = JSON.parse(roh).v2 ?? null;
    } catch {
      aus.whorls = null;
    }
    const gelesen = await seite.evaluate(() => {
      const zeilenText = document.body.innerText
        .split('\n')
        .map((z) => z.trim())
        .filter(Boolean);
      const urteil = zeilenText.find((z) => /our tests indicate/i.test(z)) ?? null;
      const statusElement = document.querySelector('#fp_status');
      const status = statusElement && statusElement.innerText ? statusElement.innerText.trim().replace(/\s+/g, ' ') : null;
      // Der Kernsatz in beiden Formen: „Your browser fingerprint has been
      // randomized …" / „… appears to be unique …" (ajax_fingerprint.html)
      // und die Tabellenzeile „Your browser has a nearly-unique fingerprint".
      // Steht ein Satz mit „randomized" da, gewinnt er; er ist das Ziel.
      const saetze = zeilenText
        .map((z) => z.replace(/^protecting you from fingerprinting\?\s*/i, ''))
        .filter((z) => /^your browser (fingerprint|has a )/i.test(z) && /fingerprint/i.test(z));
      const kernsatz = saetze.find((z) => /randomiz/i.test(z)) ?? saetze[0] ?? null;
      // GROSS geschrieben und ohne /i: So stehen die Ueberschriften der
      // Abschnitte im Text (CSS setzt sie in Versalien, innerText uebernimmt
      // das). Dieselben Woerter stehen in Klein-/Grossschreibung ein zweites
      // Mal auf der Seite, als Optionen der Merkmalsauswahl, und dort ist die
      // „naechste Zeile" die naechste Option. GEMESSEN 05.09.2026: Mit /i
      // stand unter „canvas" der Text „Hash of WebGL fingerprint".
      const gesucht = {
        canvas: [/^HASH OF CANVAS FINGERPRINT$/],
        webgl: [/^HASH OF WEBGL FINGERPRINT$/],
        audio: [/^AUDIOCONTEXT FINGERPRINT$/],
        plugins: [/^BROWSER PLUGIN DETAILS$/, /^PLUGINS$/, /^BROWSER PLUGINS$/],
        hardwareConcurrency: [/^HARDWARE CONCURRENCY$/],
      };
      const zeilen = {};
      zeilenText.forEach((z, i) => {
        for (const [schluessel, muster] of Object.entries(gesucht)) {
          if (!zeilen[schluessel] && muster.some((m) => m.test(z)) && zeilenText[i + 1]) zeilen[schluessel] = zeilenText[i + 1];
        }
      });
      return { urteil, status, kernsatz, zeilen };
    });
    aus.urteil = gelesen.urteil;
    aus.status = gelesen.status;
    aus.kernsatz = gelesen.status && /randomiz|unique|fingerprint/i.test(gelesen.status) ? gelesen.status : gelesen.kernsatz;
    aus.zeilen = gelesen.zeilen;
    // Die Punkte, wie CYT sie zaehlt: je Merkmal eines, dessen Zeile
    // „randomized" traegt (bei den vier Hashes „… by first party domain").
    aus.punkte = ['audio', 'canvas', 'webgl', 'plugins', 'hardwareConcurrency'].filter((z) => /randomiz/i.test(aus.zeilen[z] ?? '')).length;
    mkdirSync(BELEGE, { recursive: true });
    await seite.screenshot({ path: join(BELEGE, `cyt-${name}.png`), fullPage: true });
  } catch (e) {
    aus.fehler = String(e && e.message ? e.message : e);
  } finally {
    await seite.close().catch(() => {});
  }
  return aus;
}

// ── Vergleichshilfen ───────────────────────────────────────────────────────

function pixelAus(base64) {
  return Buffer.from(base64, 'base64');
}

/** Groesste Abweichung je Farbkanal und ob Alpha irgendwo abweicht. */
function vergleichePixel(a, b) {
  if (a.length !== b.length) return { farbe: Number.POSITIVE_INFINITY, alpha: true };
  let farbe = 0;
  let alpha = false;
  for (let p = 0; p < a.length; p += 4) {
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(a[p + k] - b[p + k]);
      if (d > farbe) farbe = d;
    }
    if (a[p + 3] !== b[p + 3]) alpha = true;
  }
  return { farbe, alpha };
}

/** Das Verhaeltnis mit/ohne, auf eine Nachkommastelle. */
function verhaeltnis(mit, ohne) {
  if (!ohne) return null;
  return Math.round((mit / ohne) * 10) / 10;
}

const gleicheListe = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((w, i) => w === b[i]);

/**
 * Die Nachzaehlung wie CYT, lokal: fuenf Werte zwischen zwei Sites. Ein
 * Punkt je Wert, der sich unterscheidet und auf beiden Seiten gemessen
 * wurde. Dieselben fuenf Namen wie in fetch_whorls.js.
 */
function zaehleWieCyt(x, y) {
  const werte = {
    audio: [x.audio?.summe, y.audio?.summe],
    canvas: [x.canvas, y.canvas],
    webgl: [x.webgl?.hash, y.webgl?.hash],
    plugins: [x.plugins?.serialisiert, y.plugins?.serialisiert],
    hardwareConcurrency: [x.hardwareConcurrency, y.hardwareConcurrency],
  };
  const punkte = {};
  for (const [name, [a, b]] of Object.entries(werte)) {
    punkte[name] = a !== undefined && b !== undefined && a !== null && b !== null && a !== b;
  }
  return { punkte, summe: Object.values(punkte).filter(Boolean).length };
}

// ── Lauf ───────────────────────────────────────────────────────────────────

const browserfassung = (() => {
  try {
    return execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unbekannt';
  }
})();

console.log(`\n  Fingerabdruck-Probe · ${new Date().toLocaleString('de-DE')}`);
console.log(`  ${browserfassung}`);
console.log(`  Testseite: ${SEITE} und ${seiteUrl(HOST_ZWEI)}${MIT_EFF ? `   zusaetzlich: ${CYT}` : ''}\n`);

const bericht = {
  gemessenAm: new Date().toISOString(),
  browser: browserfassung,
  erweiterung: ERWEITERUNG,
  testseite: SEITE,
  testseiteZwei: seiteUrl(HOST_ZWEI),
  laeufe: {},
  cyt: null,
};

try {
  // ── (1) Ohne Erweiterung: die Grundwerte ────────────────────────────────
  let grund;
  let grundZwei;
  {
    const { browser } = await starte(false);
    try {
      grund = (await messeSeite(browser)).ergebnis;
      grundZwei = (await messeSeite(browser, { ohneBruchprobe: true, ohneKosten: true }, '', HOST_ZWEI)).ergebnis;
      if (MIT_EFF) bericht.cyt = { ohne: await coverYourTracks(browser, 'ohne-erweiterung') };
    } finally {
      await browser.close();
    }
    bericht.laeufe.ohne = grund;
    bericht.laeufe.ohneZweiterHost = grundZwei;
    // Ohne Erweiterung muss die Seite selbst stimmen, sonst beweist der Rest nichts.
    pruefe('1', 'ohne: zwei Canvases mit gleichem Inhalt liefern denselben Hash', grund.canvas === grund.canvasZweitesElement, `${grund.canvas} / ${grund.canvasZweitesElement}`);
    pruefe('1', 'ohne: Bruchprobe auf deckendem Grund ist verlustfrei (Abweichung 0)', grund.bruch.groessteAbweichungZurErstenLesung === 0, grund.bruch.groessteAbweichungZurErstenLesung);
    pruefe('1', 'ohne: getChannelData und copyFromChannel bitgleich', grund.audio.wegeBitgleich, grund.audio.wegeBitgleich);
    pruefe('1', 'ohne: Blob-Rahmen und Data-Rahmen messen wie die Seite', grund.blobRahmen === grund.canvas && grund.dataRahmen === grund.canvas, `${grund.blobRahmen} / ${grund.dataRahmen}`);
    // Beide Hosts sind derselbe Rechner: Ohne Erweiterung muessen sie
    // dasselbe messen, sonst ist ein Unterschied mit Erweiterung keiner.
    const ohneGleich = zaehleWieCyt(grund, grundZwei);
    pruefe('1', `ohne: ${HOST} und ${HOST_ZWEI} messen dieselben fuenf Werte (0 Punkte wie CYT)`, ohneGleich.summe === 0, JSON.stringify(ohneGleich.punkte));
    if (grund.webgl) {
      pruefe('1', 'ohne: zwei WebGL-Canvases (FP2-Dreieck) liefern denselben Hash', grund.webgl.hash === grund.webglZweitesElement?.hash, `${grund.webgl.hash} / ${grund.webglZweitesElement?.hash}`);
      pruefe('1', 'ohne: readPixels nach toDataURL/toBlob unveraendert', grund.webgl.readPixelsNachExportGleich, grund.webgl.readPixelsNachExportGleich);
      bekannt('1', `ohne: WebGL-Pixel bei (${grund.webgl.pixelStelle?.join(', ')}) im Verlauf, an dem die Bitgleichheit gemessen wird`, JSON.stringify(grund.webgl.pixel));
    } else {
      bekannt('1', 'ohne: kein WebGL in diesem Browser; die WebGL-Zeilen entfallen', grund.webglFehler ?? 'kein Kontext');
    }
    if (grund.plugins) {
      pruefe('1', 'ohne: die Plugin-Liste stimmt mit sich selbst ueberein (Array.from, for-of, item, namedItem)', grund.plugins.arrayFromLaenge === grund.plugins.laenge && grund.plugins.forOfAnzahl === grund.plugins.laenge && (grund.plugins.laenge === 0 || (grund.plugins.letzterUeberItem && grund.plugins.letzterUeberNamedItem)), `${grund.plugins.laenge} Eintraege`);
    } else {
      bekannt('1', 'ohne: navigator.plugins nicht lesbar; die Plugin-Zeilen entfallen', grund.pluginsFehler ?? '?');
    }
    console.log(`  (1) Grundwerte: Canvas ${grund.canvas}, WebGL ${grund.webgl?.hash ?? '-'}, Audio ${grund.audio.summe}, Kerne ${grund.hardwareConcurrency}, Speicher ${grund.deviceMemory}, Plugins ${grund.plugins?.laenge ?? '-'}`);
  }

  // ── (2) Mit Erweiterung, Profil A ───────────────────────────────────────
  let a;
  let aZweiterTab;
  let aZwei;
  let aGefaelscht;
  let a4;
  let a4Gefaelscht;
  {
    const { browser, kennung } = await starte(true);
    try {
      const erste = await messeSeite(browser);
      a = erste.ergebnis;
      const zweite = await messeSeite(browser, { ohneBruchprobe: true, ohneKosten: true });
      aZweiterTab = zweite.ergebnis;
      // Dieselbe Seite unter dem zweiten Hostnamen: fuer die Erweiterung
      // eine andere Site, also ein anderer Seed.
      const zweiterHost = await messeSeite(browser, { ohneBruchprobe: true, ohneKosten: true }, '', HOST_ZWEI);
      aZwei = zweiterHost.ergebnis;
      // Dieselbe Seite, aber ein Kopfskript faelscht vorher „aus".
      const gefaelscht = await messeSeite(browser, { ohneBruchprobe: true, ohneKosten: true }, '?faelschung');
      aGefaelscht = gefaelscht.ergebnis;
      if (MIT_EFF) bericht.cyt.mit = await coverYourTracks(browser, 'mit-erweiterung');
      await erste.seite.close();
      await zweite.seite.close();
      await zweiterHost.seite.close();
      await gefaelscht.seite.close();

      // ── (4) im selben Profil: die Seite freigeben ───────────────────────
      const ausnahme = await ausnahmeSetzen(browser, kennung, HOST);
      bericht.ausnahme = ausnahme;
      pruefe('4', `Ausnahme fuer ${HOST} eingetragen (Weg: ${ausnahme.weg})`, ausnahme.eingetragen, ausnahme.eingetragen);
      a4 = (await messeSeite(browser, { ohneKosten: true })).ergebnis;
      // Ausnahme UND ein Fremdereignis vor der echten Antwort: Der Lauscher
      // darf nicht verbraucht sein (kein `once: true`).
      a4Gefaelscht = (await messeSeite(browser, { ohneBruchprobe: true, ohneKosten: true }, '?faelschung')).ergebnis;
    } finally {
      await browser.close();
    }
  }
  bericht.laeufe.mitA = a;
  bericht.laeufe.mitAZweiterTab = aZweiterTab;
  bericht.laeufe.mitAZweiterHost = aZwei;
  bericht.laeufe.mitAGefaelscht = aGefaelscht;
  bericht.laeufe.mitAusnahme = a4;
  bericht.laeufe.mitAusnahmeGefaelscht = a4Gefaelscht;

  // Canvas. Seit dem Nachtrag: EIN Seed je Site und Sitzung, kein Anteil je
  // Element - dieselbe Zeichnung gibt auf derselben Seite denselben Hash
  // (Umkehr der Runde-1-Probe, siehe Kopf).
  pruefe('2', 'Canvas-Hash weicht vom Grundwert ab', a.canvas !== grund.canvas, `${a.canvas} vs ${grund.canvas}`);
  pruefe('2', 'zweite Lesung desselben Canvas ist gleich (getImageData zweimal)', a.getImageDataZweimalGleich, a.getImageDataZweimalGleich);
  pruefe('2', 'zweites Canvas mit gleichem Inhalt auf derselben Seite: DERSELBE Hash (Seed je Site, kein Salz je Element)', a.canvas === a.canvasZweitesElement, `${a.canvas} vs ${a.canvasZweitesElement}`);
  pruefe('2', 'zweiter Tab derselben Site: derselbe Canvas-Hash (Sitzungsbindung)', aZweiterTab.canvas === a.canvas, `${aZweiterTab.canvas} vs ${a.canvas}`);
  pruefe('2', `${HOST_ZWEI}: anderer Canvas-Hash als ${HOST} (Seed je Site)`, aZwei.canvas !== a.canvas, `${aZwei.canvas} vs ${a.canvas}`);
  pruefe('2', `${HOST_ZWEI}: Canvas-Hash weicht vom Grundwert ab`, aZwei.canvas !== grund.canvas, `${aZwei.canvas} vs ${grund.canvas}`);
  pruefe('2', 'Canvas ohne Text entspricht dem Grundwert (Textregel)', a.canvasOhneText === grund.canvasOhneText, `${a.canvasOhneText} vs ${grund.canvasOhneText}`);
  pruefe('2', 'Textkennzeichen ueberlebt eine width-Zuweisung', a.canvasNachBreitenZuweisung !== grund.canvasOhneText, `${a.canvasNachBreitenZuweisung} vs ${grund.canvasOhneText}`);
  pruefe('2', 'negative Ausdehnung liefert dieselben Werte wie positive', a.negativeAusdehnungGleich, a.negativeAusdehnungGleich);
  pruefe('2', 'toBlob weicht vom Grundwert ab', a.toBlob !== grund.toBlob, `${a.toBlob} vs ${grund.toBlob}`);
  if (grund.offscreenGetImageData !== undefined) {
    pruefe('2', 'OffscreenCanvas getImageData weicht vom Grundwert ab', a.offscreenGetImageData !== grund.offscreenGetImageData, `${a.offscreenGetImageData} vs ${grund.offscreenGetImageData}`);
    pruefe('2', 'OffscreenCanvas convertToBlob weicht vom Grundwert ab', a.offscreenConvertToBlob !== grund.offscreenConvertToBlob, `${a.offscreenConvertToBlob} vs ${grund.offscreenConvertToBlob}`);
  }
  pruefe('2', 'blob:-Rahmen weicht vom Grundwert ab (match_origin_as_fallback)', a.blobRahmen !== grund.canvas, `${a.blobRahmen} vs ${grund.canvas}`);
  pruefe('2', 'data:-Rahmen weicht vom Grundwert ab (match_origin_as_fallback)', a.dataRahmen !== grund.canvas, `${a.dataRahmen} vs ${grund.canvas}`);
  bekannt('2', 'about:blank-Kindrahmen (per Skript erzeugt, nach 800 ms gelesen)', a.aboutBlankRahmen === grund.canvas ? 'noch nativ' : 'verrauscht');

  // WebGL wie FP2: toDataURL/toBlob rauschen ueber die Kopiestrecke,
  // readPixels bleibt bitgenau (Objekt-Picking ueber Farbcodes).
  if (grund.webgl && a.webgl) {
    pruefe('2', 'WebGL (FP2-Dreieck): toDataURL weicht vom Grundwert ab', a.webgl.hash !== grund.webgl.hash, `${a.webgl.hash} vs ${grund.webgl.hash}`);
    pruefe('2', 'WebGL: toBlob weicht vom Grundwert ab', a.webgl.toBlob !== grund.webgl.toBlob, `${a.webgl.toBlob} vs ${grund.webgl.toBlob}`);
    pruefe('2', 'WebGL: zweites Canvas mit gleicher Zeichnung auf derselben Seite: derselbe Hash', a.webgl.hash === a.webglZweitesElement?.hash, `${a.webgl.hash} vs ${a.webglZweitesElement?.hash}`);
    pruefe('2', 'WebGL: zweiter Tab derselben Site: derselbe Hash', aZweiterTab.webgl?.hash === a.webgl.hash, `${aZweiterTab.webgl?.hash} vs ${a.webgl.hash}`);
    pruefe('2', `WebGL: ${HOST_ZWEI} anderer Hash als ${HOST}`, aZwei.webgl?.hash !== a.webgl.hash, `${aZwei.webgl?.hash} vs ${a.webgl.hash}`);
    pruefe('2', 'WebGL: readPixels bitgleich zu ohne Erweiterung (ein Pixel im Verlauf)', gleicheListe(a.webgl.pixel, grund.webgl.pixel), `${JSON.stringify(a.webgl.pixel)} vs ${JSON.stringify(grund.webgl.pixel)}`);
    pruefe('2', 'WebGL: readPixels ueber das ganze Bild bitgleich zu ohne Erweiterung', a.webgl.readPixelsHash === grund.webgl.readPixelsHash, `${a.webgl.readPixelsHash} vs ${grund.webgl.readPixelsHash}`);
    pruefe('2', 'WebGL: readPixels nach toDataURL/toBlob unveraendert (die Kopie liest, sie schreibt nicht)', a.webgl.readPixelsNachExportGleich, a.webgl.readPixelsNachExportGleich);
  } else if (grund.webgl) {
    pruefe('2', 'WebGL: mit Erweiterung messbar', false, a.webglFehler ?? 'kein Ergebnis');
  }

  // Die Faelschung: ein Kopfskript schickt „aus", ein Fremdereignis und eine Handschlag-Frage.
  pruefe('2', 'Faelschung: ein "0" der Seite schaltet nichts ab (Canvas weiter verrauscht)', aGefaelscht.canvas !== grund.canvas, `${aGefaelscht.canvas} vs ${grund.canvas}`);
  pruefe('2', 'Faelschung: die Handschlag-Frage der Seite bekommt keine Antwort', aGefaelscht.faelschung && aGefaelscht.faelschung.antwortAufFrage === null, JSON.stringify(aGefaelscht.faelschung));
  // Das Kopfskript schickt drei Ereignisse mit dem Kanalnamen und lauscht selbst darauf; alle drei muss es sehen.
  pruefe('2', 'Faelschung: die Seite sieht ihre eigenen Ereignisse wie ohne Erweiterung (nicht angehalten)', aGefaelscht.faelschung && aGefaelscht.faelschung.ereignisseGesehen === 3, aGefaelscht.faelschung && aGefaelscht.faelschung.ereignisseGesehen);

  // Bruchfaelle aus den Gegenproben vom 05.09.2026
  for (const [font, m] of Object.entries(a.phaser)) {
    const g = grund.phaser[font];
    pruefe('2', `Schriftmessung wie Phaser/Pixi (${font}): ascent/descent wie ohne Erweiterung`, m.ascent === g.ascent && m.descent === g.descent, `${m.ascent}/${m.descent} vs ${g.ascent}/${g.descent}`);
  }
  for (const [name, n] of Object.entries(a.valueOf)) {
    pruefe('2', `valueOf eines Objekt-Arguments laeuft bei ${name} genau so oft wie nativ`, n === grund.valueOf[name], `${n} vs ${grund.valueOf[name]}`);
  }
  pruefe('2', 'ein frischer AudioBuffer ist Stille', a.audioPuffer.frischNichtNull === 0, `${a.audioPuffer.frischNichtNull} Proben ungleich 0`);
  pruefe('2', 'copyToChannel liest sich bitgleich zurueck', a.audioPuffer.rueckleseAbweichend === 0, `${a.audioPuffer.rueckleseAbweichend} Proben abweichend`);
  pruefe('2', 'fuehrende Stille laesst sich abschneiden (d[i] === 0)', a.audioPuffer.trimStart === grund.audioPuffer.trimStart, `${a.audioPuffer.trimStart} vs ${grund.audioPuffer.trimStart}`);

  // Audio
  pruefe('2', 'Audiosumme weicht vom Grundwert ab', a.audio.summe !== grund.audio.summe, `${a.audio.summe} vs ${grund.audio.summe}`);
  pruefe('2', 'getChannelData und copyFromChannel in beiden Reihenfolgen bitgleich', a.audio.wegeBitgleich, a.audio.wegeBitgleich);
  pruefe('2', 'ein groesseres Zielarray bekommt hinter der Kopie nichts dazu', a.audio.hinterDerKopieNull, a.audio.hinterDerKopieNull);
  pruefe('2', 'zweiter Tab derselben Site: dieselbe Audiosumme (Sitzungsbindung)', aZweiterTab.audio.summe === a.audio.summe, `${aZweiterTab.audio.summe} vs ${a.audio.summe}`);
  pruefe('2', `${HOST_ZWEI}: andere Audiosumme als ${HOST} (Seed je Site)`, aZwei.audio.summe !== a.audio.summe, `${aZwei.audio.summe} vs ${a.audio.summe}`);

  // Geraet. `hardwareConcurrency` kommt je Site aus {2, 4, 8}; ob der Wert
  // sich vom Grundwert unterscheidet, haengt am Rechner - deshalb erst der
  // Vergleich, dann OK oder INFO. Ob die zwei Hosts verschieden ausfallen,
  // ist Wahrscheinlichkeit (zwei von drei), nie FEHL.
  pruefe('2', `hardwareConcurrency liegt in {${KERNE_MENGE.join(', ')}}`, KERNE_MENGE.includes(a.hardwareConcurrency), a.hardwareConcurrency);
  pruefe('2', 'zweiter Tab derselben Site: dieselbe Kernzahl', aZweiterTab.hardwareConcurrency === a.hardwareConcurrency, `${aZweiterTab.hardwareConcurrency} vs ${a.hardwareConcurrency}`);
  if (KERNE_MENGE.includes(grund.hardwareConcurrency)) bekannt('2', `hardwareConcurrency: dieser Rechner meldet nativ ${grund.hardwareConcurrency}, ein Wert aus der Menge; die Zeile darueber bewiese auch ohne Huelle`, a.hardwareConcurrency);
  else pruefe('2', 'hardwareConcurrency weicht vom echten Wert ab', a.hardwareConcurrency !== grund.hardwareConcurrency, `${a.hardwareConcurrency} vs ${grund.hardwareConcurrency}`);
  bekannt('2', `hardwareConcurrency auf ${HOST} und ${HOST_ZWEI}`, a.hardwareConcurrency === aZwei.hardwareConcurrency ? `gleich (${a.hardwareConcurrency}); bei drei Werten trifft das einen von drei Seeds` : `verschieden (${a.hardwareConcurrency} / ${aZwei.hardwareConcurrency})`);
  if (!grund.deviceMemoryImPrototyp) bekannt('2', 'deviceMemory gibt es in diesem Browser nicht; nichts erfunden', a.deviceMemory);
  else if (grund.deviceMemory !== 8) pruefe('2', 'deviceMemory ist 8', a.deviceMemory === 8, a.deviceMemory);
  else bekannt('2', 'deviceMemory: dieser Rechner meldet nativ 8, nicht unterscheidbar', a.deviceMemory);

  // Plugins: die echten Eintraege plus EIN erfundenes Plugin je Site. Die
  // Probe kennt den Namen nicht vorab; er ist der Eintrag, den es im
  // Grundlauf nicht gab, und er muss am letzten Index stehen.
  let erfunden = null;
  if (grund.plugins && a.plugins) {
    const echteNamen = grund.plugins.namen;
    const neue = a.plugins.namen.filter((n) => !echteNamen.includes(n));
    erfunden = neue.length === 1 ? neue[0] : null;
    pruefe('2', 'plugins: genau ein Eintrag mehr als ohne Erweiterung', a.plugins.laenge === grund.plugins.laenge + 1 && neue.length === 1, `${a.plugins.laenge} vs ${grund.plugins.laenge}; neu: ${JSON.stringify(neue)}`);
    pruefe('2', 'plugins: kein echter Eintrag fehlt', echteNamen.every((n) => a.plugins.namen.includes(n)), JSON.stringify(a.plugins.namen));
    pruefe('2', 'plugins: der erfundene Eintrag steht am letzten Index', erfunden !== null && a.plugins.letzter && a.plugins.letzter.name === erfunden, `${a.plugins.letzter?.name} vs ${erfunden}`);
    pruefe('2', 'plugins: identify_plugins (CYT) weicht vom Grundwert ab', a.plugins.serialisiert !== grund.plugins.serialisiert, a.plugins.serialisiert.slice(0, 160));
    pruefe('2', 'plugins: zweimal gelesen dasselbe', a.plugins.zweimalGleich, a.plugins.zweimalGleich);
    pruefe('2', 'plugins: zweiter Tab derselben Site: dieselbe Liste', aZweiterTab.plugins?.serialisiert === a.plugins.serialisiert, aZweiterTab.plugins?.letzter?.name);
    pruefe('2', `plugins: ${HOST_ZWEI} andere Liste als ${HOST}`, aZwei.plugins?.serialisiert !== a.plugins.serialisiert, `${aZwei.plugins?.letzter?.name} vs ${a.plugins.letzter?.name}`);
    pruefe('2', 'plugins: navigator.plugins instanceof PluginArray', a.plugins.instanceofPluginArray, a.plugins.instanceofPluginArray);
    pruefe('2', 'plugins: Object.prototype.toString "[object PluginArray]"', a.plugins.toStringTag === '[object PluginArray]', a.plugins.toStringTag);
    pruefe('2', 'plugins: Array.from(navigator.plugins).length === navigator.plugins.length', a.plugins.arrayFromLaenge === a.plugins.laenge, `${a.plugins.arrayFromLaenge} vs ${a.plugins.laenge}`);
    pruefe('2', 'plugins: for-of zaehlt length Eintraege', a.plugins.forOfAnzahl === a.plugins.laenge, `${a.plugins.forOfAnzahl} vs ${a.plugins.laenge}`);
    pruefe('2', 'plugins: for-in und Object.keys sehen je einen Schluessel mehr als ohne Erweiterung', a.plugins.forInAnzahl === grund.plugins.forInAnzahl + 1 && a.plugins.objectKeysAnzahl === grund.plugins.objectKeysAnzahl + 1, `for-in ${a.plugins.forInAnzahl} vs ${grund.plugins.forInAnzahl}, keys ${a.plugins.objectKeysAnzahl} vs ${grund.plugins.objectKeysAnzahl}`);
    pruefe('2', 'plugins: namedItem(erfundenerName) === navigator.plugins[erfundenerName] === letzter Index', a.plugins.letzterUeberNamen && a.plugins.letzterUeberNamedItem && a.plugins.letzterUeberItem, `${a.plugins.letzterUeberNamen}/${a.plugins.letzterUeberNamedItem}/${a.plugins.letzterUeberItem}`);
    pruefe('2', 'plugins: `in` kennt Index und Namen des erfundenen Eintrags', a.plugins.letzterIndexIn, a.plugins.letzterIndexIn);
    pruefe('2', 'plugins: das erfundene Plugin ist instanceof Plugin und "[object Plugin]"', a.plugins.letzterInstanceofPlugin && a.plugins.letzterToStringTag === '[object Plugin]', `${a.plugins.letzterInstanceofPlugin} / ${a.plugins.letzterToStringTag}`);
    pruefe('2', 'plugins: das erfundene Plugin hat genau einen MimeType, instanceof MimeType, ueber item/namedItem/Iterator erreichbar', a.plugins.letzter?.laenge === 1 && a.plugins.letzterMimeInstanceofMimeType && a.plugins.letzterMimeUeberItem && a.plugins.letzterIterierbar, JSON.stringify(a.plugins.letzter));
    pruefe('2', 'plugins: mimeType.enabledPlugin ist das erfundene Plugin', a.plugins.letzterMimeEnabledPlugin, a.plugins.letzterMimeEnabledPlugin);

    /*
     * Der erfundene Eintrag muss sich in JEDER Hinsicht wie ein echter
     * verhalten, auch im Fehlerfall. Eine Gegenprobe fand ihn am
     * 05.09.2026 dreimal, ohne etwas ueber AdSilence zu wissen: Sie
     * verglich die Eintraege derselben Liste miteinander. Deshalb steht
     * hier ueberall der erste (echte) neben dem letzten (erfundenen), und
     * geprueft wird Gleichheit, nicht ein fester Text - der unterscheidet
     * sich zwischen Browsern und Fassungen.
     */
    if (a.plugins.itemOhneArgument?.echt !== null) {
      pruefe(
        '2',
        'plugins: item() ohne Argument wirft am erfundenen Eintrag dieselbe Meldung wie am echten',
        a.plugins.itemOhneArgument.echt === a.plugins.itemOhneArgument.erfunden,
        `echt: ${a.plugins.itemOhneArgument.echt} | erfunden: ${a.plugins.itemOhneArgument.erfunden}`,
      );
      pruefe(
        '2',
        'plugins: namedItem() ohne Argument ebenso',
        a.plugins.namedItemOhneArgument.echt === a.plugins.namedItemOhneArgument.erfunden,
        `echt: ${a.plugins.namedItemOhneArgument.echt} | erfunden: ${a.plugins.namedItemOhneArgument.erfunden}`,
      );
      pruefe(
        '2',
        'plugins: namedItem(new String(name)) findet den erfundenen Eintrag wie einen echten',
        a.plugins.namedItemAlsObjekt.echt === a.plugins.namedItemAlsObjekt.erfunden && a.plugins.namedItemAlsObjekt.erfunden === true,
        `echt: ${a.plugins.namedItemAlsObjekt.echt} | erfunden: ${a.plugins.namedItemAlsObjekt.erfunden}`,
      );
      pruefe(
        '2',
        'plugins: delete auf den erfundenen Index gibt dasselbe wie auf einen echten',
        a.plugins.deleteIndex.echt === a.plugins.deleteIndex.erfunden,
        `echt: ${a.plugins.deleteIndex.echt} | erfunden: ${a.plugins.deleteIndex.erfunden}`,
      );
    }
    pruefe('2', 'plugins: Form wie im Vertrag (name "Wort Wort", beschreibung "… Plugin", datei "wort-wort.plugin", mimeTyp "application/x-wort-wort")', (() => {
      const l = a.plugins.letzter;
      if (!l) return false;
      const m = /^([A-Z][a-z]{4,6}) ([A-Z][a-z]{4,6})$/.exec(l.name);
      if (!m) return false;
      const [w1, w2] = [m[1].toLowerCase(), m[2].toLowerCase()];
      return l.description === `${l.name} Plugin` && l.filename === `${w1}-${w2}.plugin` && l.mimeTyp === `application/x-${w1}-${w2}` && l.suffixes === w1;
    })(), JSON.stringify(a.plugins.letzter));
    {
      const l = a.plugins.letzter ?? {};
      const felder = [l.name, l.description, l.filename, l.mimeTyp, l.suffixes, l.mimeBeschreibung].filter((w) => typeof w === 'string');
      const treffer = felder.filter((w) => VERBOTEN_IM_PLUGIN.test(w));
      pruefe('2', 'plugins: keiner der verbotenen Begriffe (pdf, flash, java, silverlight, quicktime, shockwave, vlc, media, widevine) im erfundenen Eintrag', treffer.length === 0, treffer.length ? JSON.stringify(treffer) : 'keiner');
    }
    const mt = a.plugins.mimeTypes;
    const mtGrund = grund.plugins.mimeTypes;
    pruefe('2', 'mimeTypes: genau ein Typ mehr als ohne Erweiterung, kein echter fehlt', mt.laenge === mtGrund.laenge + 1 && mtGrund.typen.every((t) => mt.typen.includes(t)), `${mt.laenge} vs ${mtGrund.laenge}`);
    pruefe('2', 'mimeTypes: instanceof MimeTypeArray, "[object MimeTypeArray]", Array.from wie length', mt.instanceofMimeTypeArray && mt.toStringTag === '[object MimeTypeArray]' && mt.arrayFromLaenge === mt.laenge, `${mt.instanceofMimeTypeArray} / ${mt.toStringTag} / ${mt.arrayFromLaenge}`);
    pruefe('2', 'mimeTypes[erfundenerTyp].enabledPlugin.name === erfundenerName', mt.letzterTypUeberNamen && mt.letzterTypUeberNamedItem && erfunden !== null && mt.enabledPluginName === erfunden, `${mt.enabledPluginName} vs ${erfunden}`);
    bekannt('2', 'PluginArray.prototype.item.call(navigator.plugins) (ein Proxy ist kein Plattformobjekt)', `${a.plugins.protoItemCall} (ohne Erweiterung: ${grund.plugins.protoItemCall})`);
  } else if (grund.plugins) {
    pruefe('2', 'plugins: mit Erweiterung lesbar', false, a.pluginsFehler ?? 'kein Ergebnis');
  }

  // Die Nachzaehlung wie CYT, lokal: fuenf Werte zwischen zwei Sites.
  {
    const z = zaehleWieCyt(a, aZwei);
    bericht.zaehlungWieCyt = z;
    pruefe('2', `Zaehlung wie Cover Your Tracks zwischen ${HOST} und ${HOST_ZWEI}: mindestens 4 von 5 Punkten (ab 4 heisst es dort "has been randomized")`, z.summe >= 4, `${z.summe} von 5: ${Object.entries(z.punkte).filter(([, p]) => p).map(([n]) => n).join(', ') || 'keiner'}`);
    /*
     * OHNE WEBGL FEHLT DER VIERTE SICHERE PUNKT. Sicher sind Audio, Canvas
     * und Plugins; WebGL ist der vierte, und in einer VM oder mit
     * `--disable-gpu` liefert die FingerprintJS2-Komponente auf beiden
     * Domains dieselbe feste Antwort - kein Unterschied, kein Punkt, und
     * nichts in der Erweiterung aendert daran etwas. Dann haengt die
     * Schwelle an der Kernzahl, die nur in zwei von drei Faellen trifft.
     * Ein stummes „3 von 5" liesse das wie einen Fehler der Erweiterung
     * aussehen; deshalb sagt die Probe hier, woran es liegt.
     */
    if (!a.webgl) {
      bekannt('2', 'Zaehlung ohne WebGL: nur drei sichere Punkte (Audio, Canvas, Plugins) plus die Zwei-Drittel-Chance der Kernzahl', a.webglFehler ?? 'kein WebGL-Kontext in diesem Browser');
    }
  }

  // Tarnkappe: buchstabengetreu der Text des Browsers.
  for (const [name, text] of Object.entries(grund.toString)) {
    pruefe('2', `toString: ${name} lautet wie nativ`, a.toString[name] === text, a.toString[name]);
  }
  bericht.toStringAnzahl = Object.keys(grund.toString).length;
  bekannt('2', 'Anzahl der geprueften toString-Texte (Liste in tests/fingerabdruck/index.html)', bericht.toStringAnzahl);
  // Fremder Realm: nach der Injektion erkennt die Tarnkappe des Rahmens die Huellen des Elternfensters am Quelltext.
  for (const [name, text] of Object.entries(grund.toString)) {
    pruefe('2', `toString aus einem fertigen about:blank-Rahmen: ${name} lautet wie nativ`, a.fremderRealm.spaeter[name] === text, a.fremderRealm.spaeter[name]);
  }
  {
    const verraten = Object.entries(a.fremderRealm.sofort).filter(([name, text]) => text !== grund.toString[name]).length;
    bekannt('2', 'toString aus einem SYNCHRON nach appendChild gelesenen about:blank-Rahmen (noch nativ, Chrome injiziert asynchron)', verraten ? `${verraten} Huellen lesbar` : 'schon getarnt');
  }
  bekannt('2', 'Prototyp eines fertigen about:blank-Rahmens auf ein Canvas des Elternfensters angewandt (Buchfuehrung je Realm)', a.fremderRealm.prototypAufEigenem === grund.canvas ? 'nativ, wie erwartet' : `verrauscht (${a.fremderRealm.prototypAufEigenem})`);
  for (const [name, l] of Object.entries(a.luegendetektor.huellen)) {
    const g = grund.luegendetektor.huellen[name];
    pruefe(
      '2',
      `Form: ${name} (kein prototype, new wirft TypeError, Eigenschaften wie nativ)`,
      g && !l.hatPrototype && l.neuWirftTypeError && l.eigenschaften === g.eigenschaften,
      `prototype=${l.hatPrototype} new=${l.neuWirftTypeError ? 'TypeError' : 'kein TypeError'} eigenschaften=${l.eigenschaften}`,
    );
  }
  for (const [eig, wert] of Object.entries(a.luegendetektor.getterFremdesThis)) {
    pruefe('2', `Getter ${eig} mit fremdem this wirft TypeError`, wert === 'TypeError', wert);
  }
  for (const [eig, wert] of Object.entries(a.luegendetektor.aufzaehlbar)) {
    pruefe('2', `Aufzaehlbarkeit wie nativ: ${eig}`, wert === grund.luegendetektor.aufzaehlbar[eig], `${wert} (ohne: ${grund.luegendetektor.aufzaehlbar[eig]})`);
  }
  bekannt('2', 'Stack ueber valueOf-Argument nennt die Erweiterung', a.stack.erweiterungImStack ? `ja: ${a.stack.zeile}` : 'nein');

  // Bruchprobe
  pruefe('2', `Bruchprobe: ${a.bruch.durchlaeufe} Lese-Schreib-Durchlaeufe, Abweichung zur ersten Lesung 0 (idempotent)`, a.bruch.groessteAbweichungZurErstenLesung === 0, a.bruch.groessteAbweichungZurErstenLesung);
  pruefe('2', 'Bruchprobe: Alpha unveraendert', !a.bruch.alphaVeraendert, a.bruch.alphaVeraendert);
  {
    const v = vergleichePixel(pixelAus(a.bruch.ersteLesungBase64), pixelAus(grund.bruch.ersteLesungBase64));
    bericht.bruchGegenGrundwert = v;
    pruefe('2', 'Bruchprobe: Abweichung zum Bild ohne Erweiterung hoechstens 1 je Kanal', v.farbe <= 1 && !v.alpha, `Farbe ${v.farbe}, Alpha ${v.alpha ? 'abweichend' : 'gleich'}`);
  }

  // Kosten: kein Bestehen oder Umfallen, eine Zahl fuer den Katalog.
  bericht.kosten = {
    wiederholungen: a.kosten.wiederholungen,
    getImageData1280x720: { ohneMs: grund.kosten.getImageData1280x720Ms, mitMs: a.kosten.getImageData1280x720Ms, verhaeltnis: verhaeltnis(a.kosten.getImageData1280x720Ms, grund.kosten.getImageData1280x720Ms) },
    toDataURL640x480: { ohneMs: grund.kosten.toDataURL640x480Ms, mitMs: a.kosten.toDataURL640x480Ms, verhaeltnis: verhaeltnis(a.kosten.toDataURL640x480Ms, grund.kosten.toDataURL640x480Ms) },
  };
  bekannt('2', `Kosten getImageData 1280x720 x${a.kosten.wiederholungen}`, `${grund.kosten.getImageData1280x720Ms} ms ohne, ${a.kosten.getImageData1280x720Ms} ms mit, Faktor ${bericht.kosten.getImageData1280x720.verhaeltnis}`);
  bekannt('2', `Kosten toDataURL 640x480 x${a.kosten.wiederholungen}`, `${grund.kosten.toDataURL640x480Ms} ms ohne, ${a.kosten.toDataURL640x480Ms} ms mit, Faktor ${bericht.kosten.toDataURL640x480.verhaeltnis}`);
  bericht.kosten.getChannelData = {
    proben: a.audioKosten.proben,
    ohneMs: grund.audioKosten.getChannelDataMs,
    mitMs: a.audioKosten.getChannelDataMs,
    renderOhneMs: grund.audioKosten.renderMs,
    renderMitMs: a.audioKosten.renderMs,
  };
  bekannt('2', `Kosten getChannelData auf ${a.audioKosten.proben} Proben (die Messung zu PROBEN_BUDGET)`, `${grund.audioKosten.getChannelDataMs} ms ohne, ${a.audioKosten.getChannelDataMs} ms mit (Rendern: ${grund.audioKosten.renderMs} / ${a.audioKosten.renderMs} ms)`);

  // ── (4) Ausnahme: alles wie der Grundwert ───────────────────────────────
  pruefe('4', 'Ausnahme: Canvas-Hash entspricht dem Grundwert', a4.canvas === grund.canvas, `${a4.canvas} vs ${grund.canvas}`);
  pruefe('4', 'Ausnahme: Audiosumme entspricht dem Grundwert', a4.audio.summe === grund.audio.summe, `${a4.audio.summe} vs ${grund.audio.summe}`);
  pruefe('4', 'Ausnahme: auch ueber die vor dem Ereignis gesicherte Referenz', a4.canvasUeberGesicherteReferenz === grund.canvas, `${a4.canvasUeberGesicherteReferenz} vs ${grund.canvas}`);
  pruefe('4', 'Ausnahme: auch im about:blank-Kindrahmen', a4.aboutBlankRahmen === grund.canvas, `${a4.aboutBlankRahmen} vs ${grund.canvas}`);
  pruefe('4', 'Ausnahme: auch im blob:-Rahmen (nach dem Sitzungsereignis)', a4.blobRahmen === grund.canvas, `${a4.blobRahmen} vs ${grund.canvas}`);
  bekannt('4', 'Ausnahme: blob:-Rahmen SOFORT nach load gelesen, vor der Antwort des Hintergrunds', a4.blobRahmenSofort === grund.canvas ? 'schon Grundwert' : `noch verrauscht (${a4.blobRahmenSofort}); das Ereignis kommt asynchron`);
  if (grund.webgl && a4.webgl) pruefe('4', 'Ausnahme: WebGL-Hash entspricht dem Grundwert', a4.webgl.hash === grund.webgl.hash, `${a4.webgl.hash} vs ${grund.webgl.hash}`);
  if (grund.plugins && a4.plugins) pruefe('4', 'Ausnahme: Plugin-Liste entspricht dem Grundwert (kein erfundener Eintrag)', a4.plugins.serialisiert === grund.plugins.serialisiert && a4.plugins.laenge === grund.plugins.laenge, `${a4.plugins.laenge} Eintraege, letzter: ${a4.plugins.letzter?.name}`);
  if (a.hardwareConcurrency !== grund.hardwareConcurrency) pruefe('4', 'Ausnahme: hardwareConcurrency ist der echte Wert', a4.hardwareConcurrency === grund.hardwareConcurrency, `${a4.hardwareConcurrency} vs ${grund.hardwareConcurrency}`);
  else bekannt('4', `Ausnahme: hardwareConcurrency mit Erweiterung war schon der echte Wert (${grund.hardwareConcurrency}), nicht unterscheidbar`, a4.hardwareConcurrency);
  pruefe('4', 'Ausnahme trotz Fremdereignis vor der echten Antwort: Canvas-Hash entspricht dem Grundwert (kein once: true)', a4Gefaelscht.canvas === grund.canvas, `${a4Gefaelscht.canvas} vs ${grund.canvas}`);
  pruefe('4', 'Ausnahme trotz Fremdereignis: Audiosumme entspricht dem Grundwert', a4Gefaelscht.audio.summe === grund.audio.summe, `${a4Gefaelscht.audio.summe} vs ${grund.audio.summe}`);
  pruefe('4', 'Ausnahme: die Huellen stehen noch (kein Rueckbau), toString weiter nativ', a4.toString['HTMLCanvasElement.prototype.toDataURL'] === grund.toString['HTMLCanvasElement.prototype.toDataURL'], a4.toString['HTMLCanvasElement.prototype.toDataURL']);

  // ── (3) Frisches Profil B: sitzungsgebunden, nicht dauerhaft ────────────
  {
    const { browser } = await starte(true);
    let b;
    try {
      b = (await messeSeite(browser, { ohneBruchprobe: true, ohneKosten: true })).ergebnis;
    } finally {
      await browser.close();
    }
    bericht.laeufe.mitB = b;
    pruefe('3', 'Profil B: Audiosumme weicht von Profil A ab (sitzungsgebunden)', b.audio.summe !== a.audio.summe, `${b.audio.summe} vs ${a.audio.summe}`);
    pruefe('3', 'Profil B: Audiosumme weicht vom Grundwert ab', b.audio.summe !== grund.audio.summe, `${b.audio.summe} vs ${grund.audio.summe}`);
    pruefe('3', 'Profil B: Canvas-Hash weicht von Profil A ab (sitzungsgebunden)', b.canvas !== a.canvas, `${b.canvas} vs ${a.canvas}`);
    if (grund.webgl && b.webgl && a.webgl) pruefe('3', 'Profil B: WebGL-Hash weicht von Profil A ab', b.webgl.hash !== a.webgl.hash, `${b.webgl.hash} vs ${a.webgl.hash}`);
    if (grund.plugins && b.plugins && a.plugins) pruefe('3', 'Profil B: erfundenes Plugin heisst anders als in Profil A', b.plugins.letzter?.name !== a.plugins.letzter?.name, `${b.plugins.letzter?.name} vs ${a.plugins.letzter?.name}`);
  }

  // ── (5) Cover Your Tracks ───────────────────────────────────────────────
  if (MIT_EFF && bericht.cyt) {
    const { ohne, mit } = bericht.cyt;
    if (mit.fehler || ohne.fehler) {
      bekannt('5', 'Cover Your Tracks konnte nicht gemessen werden', mit.fehler ?? ohne.fehler);
    } else {
      // Bestanden NUR mit „randomized" im Kernsatz: Das ist der Satz, den
      // CYT ab vier Punkten schreibt („has been randomized"). „unique",
      // „nearly-unique" und ein Fehlen des Satzes sind alle FEHL.
      pruefe('5', `Cover Your Tracks: ${mit.kernsatz ?? 'kein Kernsatz gefunden'}`, /randomiz/i.test(mit.kernsatz ?? ''), `Punkte laut Ergebnisseite: ${mit.punkte} von 5 (ohne Erweiterung: ${ohne.punkte})`);
      bekannt('5', 'CYT Urteil', `mit: ${mit.urteil ?? 'nicht gefunden'} | ohne: ${ohne.urteil ?? 'nicht gefunden'}`);
      bekannt('5', 'CYT Kernsatz ohne Erweiterung', ohne.kernsatz ?? 'nicht gefunden');
      for (const z of ['canvas', 'webgl', 'audio', 'plugins', 'hardwareConcurrency']) {
        bekannt('5', `CYT ${z}`, `mit: ${mit.zeilen[z] ?? 'nicht gefunden'} | ohne: ${ohne.zeilen[z] ?? 'nicht gefunden'}`);
      }
      bekannt('5', 'CYT Zeilen mit "randomized" (davon "by first party domain")', `${mit.punkte} von 5, davon ${['canvas', 'webgl', 'audio', 'plugins'].filter((z) => /first party/i.test(mit.zeilen[z] ?? '')).length} by first party domain`);
    }
  }
} finally {
  server.close();
  serverSechs.close();
}

// ── Bericht ────────────────────────────────────────────────────────────────

let schlecht = 0;
let reihe = '';
for (const p of proben) {
  if (p.reihe !== reihe) {
    reihe = p.reihe;
    console.log(`\n  Reihe (${reihe})`);
  }
  if (!p.gut) schlecht++;
  const marke = p.bekannt ? 'INFO' : p.gut ? 'OK  ' : 'FEHL';
  console.log(`  ${marke} ${p.name}: ${p.gemessen}`);
}

mkdirSync(BELEGE, { recursive: true });
bericht.proben = proben;
bericht.bestanden = proben.filter((p) => !p.bekannt).length - schlecht;
bericht.gesamt = proben.filter((p) => !p.bekannt).length;
// Die Pixel der Bruchprobe sind im Bericht ueberfluessig; verglichen wurde schon.
for (const lauf of Object.values(bericht.laeufe)) {
  if (lauf && lauf.bruch) lauf.bruch = { ...lauf.bruch, ersteLesungBase64: undefined };
}
writeFileSync(join(BELEGE, 'bericht.json'), JSON.stringify(bericht, null, 2));

console.log(`\n  ${bericht.bestanden} von ${bericht.gesamt} Proben bestanden.`);
console.log(`  Bericht: ${join(BELEGE, 'bericht.json')}\n`);
process.exit(schlecht ? 1 : 0);
