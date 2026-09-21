#!/usr/bin/env node
/**
 * Die Bildschirmfotos für die Store-Einträge — fünf Motive in exakt 1280x800
 * und das 300x300-Symbol, das der Edge-Store zusätzlich verlangt.
 *
 *     npm run bilder:store            # alle Motive
 *     npm run bilder:store -- --ohne-warnkarte
 *
 * Ausgabe: `store/bilder/`. Der Ordner wird versioniert — ein Store-Bild, das
 * niemand wiederherstellen kann, ist beim nächsten Designwechsel verloren.
 *
 * ── Warum vier der fünf Motive OHNE geladene Erweiterung entstehen ─────────
 * Popup und Optionsseite tragen mit `?attrappe=…` einen festen Beispielzustand
 * in sich (`src/oberflaeche/attrappe.ts`): Host `nachrichten.beispiel.de`, 37
 * blockierte Anfragen, ein erfundenes Konto. Er greift, sobald `api.runtime`
 * fehlt — also außerhalb der Erweiterung. Damit läuft der Bau kopflos, ohne
 * Fenstersystem, und liefert bei jedem Lauf dasselbe Bild.
 *
 * Ein echter Blockierzähler wäre ohnehin nicht zu fotografieren: Sobald Chrome
 * die Zahl selbst aufs Werkzeugleisten-Symbol schreibt, zeigt die Site-Karte
 * bewusst keine Zeile mehr (`src/hintergrund/badge.ts`, `'amSymbol'`). Die
 * Zahl steht dann in der Browser-Oberfläche, an die kein Werkzeug herankommt.
 *
 * Nur die Warnkarte (Motiv 4) braucht die echte Erweiterung, weil sie ein
 * Inhaltsskript in eine fremde Seite setzt. Deshalb dort `headless: false`
 * und unter Linux eine Anzeige von Xvfb.
 *
 * ── Warum die Endgröße in einem ZWEITEN Browser entsteht ───────────────────
 * Im dekorierten Fenster bestimmt die Fensterleiste mit, wie hoch der
 * Inhaltsbereich wirklich ist; ein HiDPI-Bildschirm verdoppelt zusätzlich die
 * Pixel. Beides ergibt Bilder, die fast stimmen. Die Rohaufnahmen bleiben
 * deshalb im Speicher und werden in einem kopflosen Browser mit fest
 * gesetztem 1280x800-Sichtfeld auf eine Bühne gelegt. Playwright ist damit
 * der Bildzusammensetzer, und es kommt keine Abhängigkeit dazu.
 *
 * Die Bühne zeichnet eine NEUTRALE Fensterleiste, keine Chrome-Nachbildung:
 * Eine nachgebaute fremde Browser-Oberfläche im Store-Bild ist ein
 * Ablehnungsgrund.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAKET = join(WURZEL, 'dist', 'chromium');
const SVG = join(WURZEL, 'icons', 'adsilence-icon.svg');

const argument = (name, standard = null) => {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : standard;
};
const AUS = argument('aus', join(WURZEL, '..', 'store', 'bilder'));
const OHNE_WARNKARTE = process.argv.includes('--ohne-warnkarte');

/**
 * In welcher Sprache die Bilder entstehen.
 *
 * ── Warum Englisch die Vorgabe ist ────────────────────────────────────────
 * Die Store-Eintraege stehen auf Englisch als Bearbeitungssprache (siehe
 * `store/chrome-web-store.md`). Bilder in einer anderen Sprache als der
 * Beschreibung daneben sehen aus, als gehoerten sie nicht zusammen — und die
 * Bilder sind das, was zuerst gesehen wird.
 *
 * Eine zweite Sprache holt man sich mit `--sprache=de --aus=<ordner>`; ohne
 * eigenen Ordner ueberschriebe sie die englischen.
 */
const SPRACHE = argument('sprache', 'en');

/**
 * Der erfundene Host, den Popup und Adressleiste zeigen.
 *
 * `beispiel.de` liest sich in einem englischen Bild wie ein Versehen;
 * `example.com` ist genauso erfunden (RFC 2606) und in jeder Sprache
 * neutral. Die Attrappe nimmt ihn ueber `?host=` entgegen — sonst stuende in
 * der Karte ein anderer Name als in der Leiste darunter.
 */
const BEISPIELSATZ = SPRACHE === 'de' ? 'de' : 'international';
const BEISPIEL_HOST = SPRACHE === 'de' ? 'nachrichten.beispiel.de' : 'news.example.com';

/** Fest, damit zwei Läufe dieselben Bilder ergeben. */
const ZEITPUNKT = Date.parse('2026-03-01T12:00:00Z');
const BREIT = 1280;
const HOCH = 800;
const LEISTE = 40; // Höhe der neutralen Fensterleiste auf der Bühne
const INHALT = HOCH - LEISTE;

function abbruch(satz) {
  process.stderr.write(`[store-bilder] ${satz}\n`);
  process.exit(1);
}

// ── 1. Ist das Paket da, vollständig und aktuell? ──────────────────────────
if (!existsSync(join(PAKET, 'manifest.json'))) {
  abbruch('dist/chromium fehlt.  → ADSILENCE_API=https://adsilence.net npm run build');
}
for (const p of ['popup/index.html', 'optionen/index.html', 'seiten/popup.js', 'seiten/optionen.js', 'hintergrund/index.js']) {
  if (!existsSync(join(PAKET, p))) abbruch(`dist/chromium ist unvollständig (${p} fehlt).  → npm run build`);
}
{
  const alleDateien = (ordner) =>
    readdirSync(ordner, { withFileTypes: true }).flatMap((e) =>
      e.name === 'node_modules' ? [] : e.isDirectory() ? alleDateien(join(ordner, e.name)) : [join(ordner, e.name)],
    );
  const quelle = Math.max(
    ...['src', 'i18n', 'icons', 'manifest'].flatMap((o) => alleDateien(join(WURZEL, o))).map((f) => statSync(f).mtimeMs),
  );
  const bau = Math.min(
    ...['manifest.json', 'seiten/popup.js', 'seiten/optionen.js'].map((f) => statSync(join(PAKET, f)).mtimeMs),
  );
  if (quelle > bau) {
    abbruch(
      `dist/chromium ist älter als der Quelltext (${new Date(quelle).toISOString()} > ${new Date(bau).toISOString()}).` +
        '\n              → ADSILENCE_API=https://adsilence.net npm run build',
    );
  }
}

let chromium;
try {
  ({ chromium } = await import(new URL('../node_modules/playwright/index.mjs', import.meta.url).href));
} catch {
  abbruch('Playwright fehlt.  → cd extension && npm i && npx playwright install chromium');
}
if (!existsSync(chromium.executablePath())) {
  abbruch('Der Browser von Playwright fehlt.  → npx playwright install chromium');
}

// ── 2. Ein lokaler Server: das Paket plus die Bühnenseite ──────────────────
const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Eine erfundene Nachrichtenseite als Hintergrund für Motiv 1 (Regel 1). */
/**
 * Der Rumpf der erfundenen Nachrichtenseite, je Sprache.
 *
 * Sie ist der Hintergrund von Motiv 1 und damit selbst im Bild — eine
 * deutsche Seite hinter einem englischen Popup faellt sofort auf. Erfunden
 * bleibt sie in jeder Sprache (Regel 1): `example.com` und `beispiel.de` sind
 * beide reserviert und gehoeren niemandem.
 */
const INHALTE = {
  de: `<header><span class="marke">Beispiel Nachrichten</span>
<nav><span>Politik</span><span>Wirtschaft</span><span>Technik</span><span>Kultur</span></nav></header>
<main>
  <h1>Warum Werbenetze täglich neue Server eintragen</h1>
  <div class="zeile">Von Max Mustermann · Musterstadt</div>
  <div class="bild"></div>
  <p>Zwischen zwei Veröffentlichungen einer Filterliste vergehen Tage. In dieser Zeit
     wechseln Werbenetze die Adressen, über die sie ausliefern — oft mehrmals.</p>
  <div class="platz">hier stand Werbung</div>
  <p>Wer misst, statt zu schätzen, sieht den Unterschied sofort: Dieselbe Seite lädt
     ohne die Zähldienste in einem Bruchteil der Zeit und überträgt einen Bruchteil
     der Daten.</p>
  <p>Die Adressen, über die gezählt wird, tarnen sich zunehmend als eigene Adresse
     der besuchten Seite. Ein Blocker, der nur nach fremden Servern sucht, sieht
     davon nichts mehr.</p>
</main>`,
  en: `<header><span class="marke">Example News</span>
<nav><span>Politics</span><span>Business</span><span>Technology</span><span>Culture</span></nav></header>
<main>
  <h1>Why ad networks register new servers every day</h1>
  <div class="zeile">By Jane Doe · Anytown</div>
  <div class="bild"></div>
  <p>Days pass between two releases of a filter list. In that time ad networks change
     the addresses they deliver from — often more than once.</p>
  <div class="platz">an ad used to be here</div>
  <p>Measure instead of guessing and the difference shows up at once: the same page
     loads in a fraction of the time without the tracking services, and transfers a
     fraction of the data.</p>
  <p>The addresses used for tracking increasingly disguise themselves as addresses of
     the site you are visiting. A blocker that only looks for foreign servers no
     longer sees them.</p>
</main>`,
};

const TITEL_SEITE = { de: 'Beispiel Nachrichten', en: 'Example News' };

const NACHRICHTENSEITE = `<!doctype html><html lang="${SPRACHE}"><head><meta charset="utf-8">
<title>${TITEL_SEITE[SPRACHE] ?? TITEL_SEITE.en}</title><style>
  :root { color-scheme: light }
  body { margin:0; font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif; color:#1a1d23; background:#fff }
  header { border-bottom:1px solid #e3e6ea; padding:14px 40px; display:flex; align-items:center; gap:14px }
  .marke { font-weight:700; font-size:20px; letter-spacing:-.02em }
  nav { display:flex; gap:18px; color:#5a6472; font-size:14px }
  main { max-width:760px; padding:34px 40px 60px }
  h1 { font-size:34px; line-height:1.2; margin:0 0 12px; letter-spacing:-.02em }
  .zeile { color:#6b7480; font-size:13px; margin-bottom:22px }
  p { margin:0 0 16px; color:#2b313a }
  .bild { height:220px; border-radius:10px; background:linear-gradient(135deg,#dfe5ec,#c9d3de); margin:0 0 22px }
  .platz { border:1px dashed #d7dce3; border-radius:8px; color:#aab2bd; font-size:12px;
           display:flex; align-items:center; justify-content:center; height:90px; margin:22px 0 }
</style></head><body>
${INHALTE[SPRACHE] ?? INHALTE.en}
</body></html>`;

const server = createServer((req, antwort) => {
  const pfad = (req.url ?? '/').split('?')[0];
  if (pfad === '/buehne/nachrichten.html' || pfad === '/') {
    antwort.writeHead(200, { 'content-type': TYPEN['.html'] });
    antwort.end(NACHRICHTENSEITE);
    return;
  }
  const datei = join(PAKET, pfad.replace(/^\/+/, ''));
  if (!datei.startsWith(PAKET) || !existsSync(datei) || statSync(datei).isDirectory()) {
    antwort.writeHead(404).end('nicht da');
    return;
  }
  antwort.writeHead(200, { 'content-type': TYPEN[extname(datei)] ?? 'application/octet-stream' });
  antwort.end(readFileSync(datei));
});
await new Promise((f) => server.listen(0, '127.0.0.1', f));
const port = server.address().port;
const adresse = (p) => `http://127.0.0.1:${port}${p}`;

// ── 3. Ein Kontext, in dem sich zwei Läufe nicht unterscheiden ─────────────
/*
 * Die Kennung des Kontexts. Sie entscheidet nicht ueber die Oberflaeche der
 * Erweiterung — die haengt an `einstellungen.sprache` weiter unten —, wohl
 * aber ueber Datums- und Zahlformate, und die stehen im Popup („Premium bis
 * …"). Ein englisches Popup mit deutschem Datum ist genau die Art Detail, die
 * ein Bild unecht wirken laesst.
 */
const KENNUNG = { de: 'de-DE', en: 'en-US', es: 'es-ES', fr: 'fr-FR', it: 'it-IT',
  ja: 'ja-JP', ko: 'ko-KR', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-PT' };

const RUHIG = {
  locale: KENNUNG[SPRACHE] ?? SPRACHE,
  timezoneId: 'Europe/Berlin',
  colorScheme: 'light',
  reducedMotion: 'reduce',
  deviceScaleFactor: 1,
};

/** Die Uhr anhalten: die Attrappe rechnet „Premium bis …" aus `Date.now()`. */
const UHR_ANHALTEN = `{
  const Echt = Date;
  Date = class extends Echt {
    constructor(...a) { super(...(a.length ? a : [${ZEITPUNKT}])); }
    static now() { return ${ZEITPUNKT}; }
  };
  Date.parse = Echt.parse; Date.UTC = Echt.UTC;
}`;

async function ruhigerKontext(browser) {
  const ctx = await browser.newContext(RUHIG);
  await ctx.addInitScript(UHR_ANHALTEN);
  // Nichts aus dem Netz darf ein Bild verändern oder einen Lauf aufhalten.
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  return ctx;
}

async function fertigGeladen(seite) {
  await seite.evaluate(() => document.fonts.ready);
  await seite.waitForTimeout(400);
}

// ── 4. Spur A: Popup und Optionsseite aus der Attrappe ─────────────────────
const roh = {};
const browserA = await chromium.launch({ headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
try {
  const ctx = await ruhigerKontext(browserA);

  // Motiv 1a — das Popup, in seiner echten Breite (popup.css: 360px).
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(adresse(`/popup/index.html?attrappe=premium&beispiele=${BEISPIELSATZ}`), { waitUntil: 'load' });
  await fertigGeladen(popup);
  const hoehe = await popup.evaluate(() => document.documentElement.scrollHeight);
  await popup.setViewportSize({ width: 360, height: Math.min(hoehe, INHALT - 24) });
  roh.popup = await popup.screenshot({ type: 'png' });

  // Motiv 1b — die Seite dahinter.
  const seite = await ctx.newPage();
  await seite.setViewportSize({ width: BREIT, height: INHALT });
  await seite.goto(adresse('/buehne/nachrichten.html'), { waitUntil: 'load' });
  await fertigGeladen(seite);
  roh.hintergrund = await seite.screenshot({ type: 'png' });

  // Motive 2, 3, 5 — die Optionsseite.
  // Die Optionsseite ist kuerzer als 760 Pixel; in voller Hoehe aufgenommen
  // blieb ein Drittel des Store-Bildes leer. Sie wird deshalb SCHMALER
  // aufgenommen (1120) und nur so hoch wie ihr Inhalt - die Buehne skaliert
  // das Bild danach auf 1280 Breite, und der Inhalt fuellt die Flaeche.
  const OPTIONEN_BREIT = 1120;
  const optionen = await ctx.newPage();
  await optionen.setViewportSize({ width: OPTIONEN_BREIT, height: INHALT });

  /** Wie hoch ist der tatsaechliche Inhalt? Tiefste Unterkante plus Rand. */
  const inhaltshoehe = async () => {
    const unten = await optionen.evaluate(() => {
      let tief = 0;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) tief = Math.max(tief, r.bottom + window.scrollY);
      }
      return Math.ceil(tief);
    });
    // Das Seitenverhaeltnis der Buehnenflaeche nicht unterschreiten, sonst
    // bleibt unten trotzdem ein Streifen: 1120 zu X wie 1280 zu 760.
    const mindest = Math.round((OPTIONEN_BREIT * INHALT) / BREIT);
    return Math.max(mindest, Math.min(unten + 32, 1400));
  };

  await optionen.goto(adresse(`/optionen/index.html?attrappe=premium&beispiele=${BEISPIELSATZ}`), { waitUntil: 'load' });
  await fertigGeladen(optionen);
  await optionen.setViewportSize({ width: OPTIONEN_BREIT, height: await inhaltshoehe() });
  roh.filterlisten = await optionen.screenshot({ type: 'png' });

  const reiter = optionen.locator('.nav__eintrag');
  if ((await reiter.count()) > 1) {
    await reiter.nth(1).click();
    await optionen.waitForTimeout(500);
  }
  await optionen.setViewportSize({ width: OPTIONEN_BREIT, height: await inhaltshoehe() });
  roh.einstellungen = await optionen.screenshot({ type: 'png' });

  // Motiv 5 — dieselbe Seite OHNE Premium: der gesperrte Block mit Schlössern.
  await optionen.goto(adresse(`/optionen/index.html?attrappe=1&beispiele=${BEISPIELSATZ}`), { waitUntil: 'load' });
  await fertigGeladen(optionen);
  const schloss = optionen.locator('[class*="schloss"], [class*="kauf"], [data-premium]').first();
  if (await schloss.count()) {
    await schloss.scrollIntoViewIfNeeded().catch(() => {});
    await optionen.waitForTimeout(400);
  }
  await optionen.setViewportSize({ width: OPTIONEN_BREIT, height: await inhaltshoehe() });
  roh.premium = await optionen.screenshot({ type: 'png' });
} finally {
  await browserA.close();
}

// ── 5. Spur B: die Warnkarte, mit echter Erweiterung ───────────────────────
let anzeige = null;
if (!OHNE_WARNKARTE) {
  if (process.env.DISPLAY) {
    anzeige = { name: process.env.DISPLAY, beenden: () => {} };
  } else if (!existsSync('/usr/bin/Xvfb')) {
    process.stderr.write(
      '[store-bilder] Motiv 4 (Warnkarte) braucht eine Anzeige, und Xvfb fehlt.\n' +
        '              → sudo apt-get install -y xvfb\n' +
        '              → oder: npm run bilder:store -- --ohne-warnkarte\n',
    );
  } else {
    const name = `:${99 + (process.pid % 50)}`;
    const p = spawn('/usr/bin/Xvfb', [name, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    await new Promise((f) => setTimeout(f, 900));
    anzeige = { name, beenden: () => p.kill('SIGTERM') };
  }
}

if (anzeige) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    env: { ...process.env, DISPLAY: anzeige.name },
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    viewport: { width: BREIT, height: INHALT },
    ...RUHIG,
    args: [
      `--disable-extensions-except=${PAKET}`,
      `--load-extension=${PAKET}`,
      `--host-resolver-rules=MAP paypa1.com 127.0.0.1:${port}`,
      `--window-size=${BREIT},${INHALT + 120}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
    ],
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 30000 }));
    await new Promise((f) => setTimeout(f, 1500));
    // Premium und Warner an, wie bei einem zahlenden Kunden.
    // `sprache` als ARGUMENT und nicht aus dem Abschluss: `evaluate` laeuft im
    // Service Worker der Erweiterung, nicht in diesem Prozess. Eine Variable
    // von hier ist dort schlicht nicht da — der Aufruf warf `ReferenceError`,
    // und Motiv 4 fehlte danach kommentarlos in der Ausgabe.
    await sw.evaluate(async (sprache) => {
      const { einstellungen } = await chrome.storage.local.get('einstellungen');
      await chrome.storage.local.set({
        einstellungen: { ...einstellungen, aktiv: true, warnung: true, sprache, thema: 'hell' },
        lizenz: {
          tarif: 'premium', premium: true, planKeys: ['premium'],
          gueltigBis: null, endetZumTermin: false, hinweis: null, geprueftAm: Date.now(),
        },
      });
    }, SPRACHE);
    const seite = await ctx.newPage();
    await seite.setViewportSize({ width: BREIT, height: INHALT });
    await seite.goto(`http://paypa1.com:${port}/`, { waitUntil: 'load' });
    await seite.waitForSelector('#adsilence-verwechslungswarnung', { timeout: 15000 });
    await seite.waitForTimeout(900);
    roh.warnkarte = await seite.screenshot({ type: 'png' });
  } catch (e) {
    process.stderr.write(`[store-bilder] Motiv 4 nicht entstanden: ${String(e).slice(0, 160)}\n`);
  } finally {
    await ctx.close();
    rmSync(join(PAKET, '_metadata'), { recursive: true, force: true });
    anzeige.beenden();
  }
}

// ── 6. Die Bühne: aus jeder Rohaufnahme ein Bild in exakt 1280x800 ─────────
const BUEHNE_CSS = `
  html,body { margin:0; padding:0; background:#eef1f5 }
  .rahmen { width:${BREIT}px; height:${HOCH}px; overflow:hidden; background:#fff }
  .leiste { height:${LEISTE}px; display:flex; align-items:center; gap:8px; padding:0 14px;
            background:#e8ebf0; border-bottom:1px solid #d8dde4; box-sizing:border-box }
  .punkt { width:11px; height:11px; border-radius:50%; background:#c8cfd8 }
  .pille { margin-left:10px; flex:1; height:22px; border-radius:11px; background:#fff;
           border:1px solid #d8dde4; display:flex; align-items:center; padding:0 12px;
           font:12px/1 ui-monospace,Menlo,monospace; color:#6b7480 }
  .flaeche { position:relative; width:${BREIT}px; height:${INHALT}px; overflow:hidden; background:#f1f3f7 }
  .flaeche > img.voll { display:block; width:${BREIT}px; height:auto }
  .flaeche > img.popup { position:absolute; top:12px; right:18px; width:360px;
                         border-radius:12px; box-shadow:0 18px 46px rgba(16,22,33,.28) }
`;

function buehne(bild, { titel, popup = null }) {
  const alsQuelle = (puffer) => `data:image/png;base64,${puffer.toString('base64')}`;
  return `<!doctype html><html lang="${SPRACHE}"><head><meta charset="utf-8"><style>${BUEHNE_CSS}</style></head><body>
    <div class="rahmen">
      <div class="leiste"><span class="punkt"></span><span class="punkt"></span><span class="punkt"></span>
        <span class="pille">${titel}</span></div>
      <div class="flaeche"><img class="voll" src="${alsQuelle(bild)}">
        ${popup ? `<img class="popup" src="${alsQuelle(popup)}">` : ''}</div>
    </div></body></html>`;
}

/**
 * Die Beschriftung der Adressleiste je Motiv.
 *
 * Sie steht hier und nicht in der Erweiterung — die Buehne zeichnet die
 * Leiste selbst. Beim Popup MUSS sie mit dem Host uebereinstimmen, den die
 * Attrappe zeigt (`BEISPIEL_HOST`), sonst steht in der Leiste eine andere
 * Seite als in der Karte darueber.
 */
const REITER = {
  de: { filterlisten: 'AdSilence — Filterlisten', einstellungen: 'AdSilence — Einstellungen', premium: 'AdSilence — Premium' },
  en: { filterlisten: 'AdSilence — Filter lists', einstellungen: 'AdSilence — Settings', premium: 'AdSilence — Premium' },
};
const R = REITER[SPRACHE] ?? REITER.en;

const MOTIVE = [
  { datei: '1-popup-zaehler.png', bild: () => roh.hintergrund, popup: () => roh.popup, titel: BEISPIEL_HOST },
  { datei: '2-filterlisten.png', bild: () => roh.filterlisten, titel: R.filterlisten },
  { datei: '3-einstellungen.png', bild: () => roh.einstellungen, titel: R.einstellungen },
  { datei: '4-warnkarte.png', bild: () => roh.warnkarte, titel: 'paypa1.com' },
  { datei: '5-premium.png', bild: () => roh.premium, titel: R.premium },
];

mkdirSync(AUS, { recursive: true });
const geschrieben = [];
const browserB = await chromium.launch({ headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
try {
  const ctx = await browserB.newContext({ ...RUHIG, viewport: { width: BREIT, height: HOCH } });
  const seite = await ctx.newPage();
  for (const motiv of MOTIVE) {
    const bild = motiv.bild();
    if (!bild) continue;
    await seite.setContent(buehne(bild, { titel: motiv.titel, popup: motiv.popup?.() ?? null }));
    await seite.waitForTimeout(250);
    const ziel = join(AUS, motiv.datei);
    writeFileSync(ziel, await seite.screenshot({ type: 'png' }));
    geschrieben.push(ziel);
  }

  // Das Symbol für den Edge-Store: aus dem SVG, nicht aus der 128er-PNG.
  const symbol = await ctx.newPage();
  await symbol.setViewportSize({ width: 300, height: 300 });
  await symbol.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:300px;height:300px;display:block}</style>${readFileSync(SVG, 'utf8')}`,
  );
  await symbol.waitForTimeout(200);
  const symbolZiel = join(AUS, 'symbol-300.png');
  writeFileSync(symbolZiel, await symbol.screenshot({ type: 'png', omitBackground: true }));
  geschrieben.push(symbolZiel);
} finally {
  await browserB.close();
  server.close();
}

// ── 7. Nachmessen: die Maße stehen im PNG-Kopf (IHDR, Bytes 16-24) ─────────
const masse = (datei) => {
  const p = readFileSync(datei);
  return { breit: p.readUInt32BE(16), hoch: p.readUInt32BE(20) };
};
let schlecht = 0;
for (const datei of geschrieben) {
  const soll = datei.endsWith('symbol-300.png') ? [300, 300] : [BREIT, HOCH];
  const { breit, hoch } = masse(datei);
  const gut = breit === soll[0] && hoch === soll[1];
  if (!gut) schlecht += 1;
  process.stdout.write(`${gut ? 'OK  ' : 'FEHL'}  ${datei.replace(join(WURZEL, '..'), '')}  ${breit}x${hoch}\n`);
}
const fehlend = MOTIVE.filter((m) => !m.bild()).map((m) => m.datei);
if (fehlend.length) process.stdout.write(`\nnicht entstanden: ${fehlend.join(', ')}\n`);

writeFileSync(
  join(AUS, 'stand.json'),
  JSON.stringify(
    {
      version: JSON.parse(readFileSync(join(PAKET, 'manifest.json'), 'utf8')).version,
      gebautAm: new Date().toISOString(),
      motive: geschrieben.map((g) => g.split('/').pop()),
    },
    null,
    2,
  ) + '\n',
);

process.stdout.write(`\n${geschrieben.length - schlecht}/${geschrieben.length} Bilder in Ordnung → ${AUS}\n`);
process.exitCode = schlecht || fehlend.length ? 1 : 0;
