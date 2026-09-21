/**
 * Der Beweis: blockt die gebaute Erweiterung wirklich?
 *
 * Startet einen kleinen Webserver, der drei Rollen spielt (Seite, Werbeserver,
 * Zaehlserver), laedt ein echtes Chrome MIT der entpackten Erweiterung und
 * misst an der Koederseite, was ankommt und was verschwindet.
 *
 *     node probe.mjs <pfad-zu-dist/chromium>
 *
 * Rueckgabe 0 = alle Proben bestanden. Jede Probe nennt Erwartung und Messung.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Playwright ist ABSICHTLICH keine Abhaengigkeit dieses Pakets: Es bringt
// einen ganzen Browser mit (rund 150 MB), und diese eine Probe ist der
// einzige Ort, der ihn braucht. Wer sie fahren will, holt ihn sich; wer nur
// baut, packt und veroeffentlicht, soll ihn nicht herunterladen muessen.
// Deshalb ein dynamischer Import mit einer Ansage statt eines nackten
// ERR_MODULE_NOT_FOUND.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Diese Probe braucht Playwright. Einmalig einrichten:\n');
  console.error('  npm install --no-save playwright');
  console.error('  npx playwright install chromium\n');
  console.error('Danach: npm run probe:koeder');
  process.exit(2);
}

const HIER = dirname(fileURLToPath(import.meta.url));
const ERWEITERUNG = resolve(process.argv[2] ?? join(HIER, '..', '..', 'dist', 'chromium'));

/** Was der Werbeserver zu sehen bekommen hat. Muss leer bleiben. */
const angefragt = [];

const server = createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  // Alles ausser der Seite selbst gilt als Werbe- oder Zaehlanfrage.
  if (host !== 'seite.koeder.test') {
    angefragt.push(`${host}${req.url}`);
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end('window.canRunAds = true;');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(join(HIER, '..', 'koeder', 'index.html'), 'utf8'));
});

const proben = [];
const pruefe = (name, erwartet, gemessen) =>
  proben.push({ name, erwartet, gemessen, gut: String(erwartet) === String(gemessen) });

const port = await new Promise((fertig) => {
  server.listen(0, '127.0.0.1', () => fertig(server.address().port));
});

const CHROME =
  process.env.ADSILENCE_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launchPersistentContext('', {
  executablePath: CHROME,
  headless: false,
  // Playwright gibt von sich aus `--disable-extensions` mit; damit laedt
  // `--load-extension` nichts. Beide muessen weg.
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    `--disable-extensions-except=${ERWEITERUNG}`,
    `--load-extension=${ERWEITERUNG}`,
    `--host-resolver-rules=MAP *.koeder.test 127.0.0.1:${port},MAP pagead2.googlesyndication.com 127.0.0.1:${port},MAP www.google-analytics.com 127.0.0.1:${port},MAP 12thman.com 127.0.0.1:${port}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  // Der Service Worker der Erweiterung muss starten, sonst ist nichts geladen.
  let arbeiter = browser.serviceWorkers()[0];
  if (!arbeiter) {
    try {
      arbeiter = await browser.waitForEvent('serviceworker', { timeout: 20000 });
    } catch {
      arbeiter = null;
    }
  }
  pruefe('Service Worker laeuft', true, Boolean(arbeiter));
  const kennung = arbeiter ? new URL(arbeiter.url()).host : null;

  // Die Erweiterung braucht einen Moment, bis die Regelsaetze stehen.
  const seite = await browser.newPage();
  await seite.waitForTimeout(2500);
  await seite.goto(`http://seite.koeder.test:${port}/`, { waitUntil: 'load' });
  await seite.waitForTimeout(1500);

  pruefe('Werbeskript blockiert (googlesyndication)', 0, angefragt.filter((a) => a.includes('googlesyndication')).length);
  pruefe('Zaehldienst blockiert (google-analytics)', 0, angefragt.filter((a) => a.includes('google-analytics')).length);

  const sichtbar = (wahl) =>
    seite.evaluate((w) => {
      const el = document.querySelector(w);
      if (!el) return 'fehlt';
      return getComputedStyle(el).display === 'none' ? 'versteckt' : 'sichtbar';
    }, wahl);

  pruefe('#AdBar versteckt', 'versteckt', await sichtbar('#AdBar'));
  pruefe('#ad-banner-1 versteckt', 'versteckt', await sichtbar('#ad-banner-1'));
  pruefe('#AD_300 versteckt', 'versteckt', await sichtbar('#AD_300'));

  const imSchatten = (name) =>
    seite.evaluate((n) => {
      const wurzel = window[n];
      if (!wurzel) return 'fehlt';
      const el = wurzel.querySelector('#AdBar');
      if (!el) return 'fehlt';
      return getComputedStyle(el).display === 'none' ? 'versteckt' : 'sichtbar';
    }, name);

  pruefe('Shadow DOM offen: versteckt', 'versteckt', await imSchatten('__koederOffen'));
  pruefe('Shadow DOM geschlossen: versteckt', 'versteckt', await imSchatten('__koederZu'));

  // Auf der erfundenen Koederdomain gibt es kein Scriptlet - das waere auch
  // bei jedem anderen Blocker so. Geprueft wird deshalb an einer Domain, fuer
  // die in `uBlock filters` wirklich eine Regel steht:
  // `12thman.com##+js(set-constant, blockAdBlock, trueFunc)`.
  const scriptletSeite = await browser.newPage();
  await scriptletSeite.goto(`http://12thman.com:${port}/`, { waitUntil: 'load' });
  await scriptletSeite.waitForTimeout(800);
  pruefe(
    'Scriptlet greift (12thman.com: blockAdBlock)',
    'function',
    await scriptletSeite.evaluate(() => typeof window.blockAdBlock),
  );

  // Das Popup muss sich oeffnen lassen und den Host zeigen.
  if (kennung) {
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${kennung}/popup/index.html`);
    await popup.waitForTimeout(1500);
    const text = await popup.evaluate(() => document.body.innerText.slice(0, 400));
    pruefe('Popup rendert Inhalt', true, text.trim().length > 10);
    if (text.trim().length <= 10) console.log('Popup-Inhalt war:', JSON.stringify(text));
  }
} finally {
  await browser.close();
  server.close();
}

let schlecht = 0;
for (const p of proben) {
  if (!p.gut) schlecht++;
  console.log(`${p.gut ? 'OK  ' : 'FEHL'} ${p.name}: erwartet ${p.erwartet}, gemessen ${p.gemessen}`);
}
if (angefragt.length) console.log('Angefragt wurde:', angefragt.join(', '));
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exit(schlecht ? 1 : 0);
