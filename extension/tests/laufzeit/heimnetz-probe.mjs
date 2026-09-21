/**
 * Der Beweis fuer die Heimnetz-Liste.
 *
 * Zwei Dinge stehen hier auf dem Spiel, und beide sind schon schiefgegangen:
 *
 *   1. Die Liste schliesst `[::1]` und `[::]` von ihren Regeln aus - IPv6 in
 *      eckigen Klammern. Unsere Hostpruefung war strenger als Chrome und warf
 *      deshalb nicht die eine Angabe weg, sondern die GANZE Regel: 71 von 99
 *      Zeilen. Ein zu strenger Wert kostet hier alles, ein zu lockerer laesst
 *      Chrome den Regelsatz abweisen - deshalb prueft die erste Probe, ob
 *      ueberhaupt noch etwas blockt.
 *   2. Wer selbst entwickelt, ruft seinen Server auf 127.0.0.1 auf. Blockte
 *      die Liste den mit, waere sie unbrauchbar - und es fiele erst dem
 *      Nutzer auf, nicht uns.
 *
 * Gemessen wird ueber HTTP. Von einer HTTPS-Seite aus weist Chrome eine
 * Anfrage an `http://fritz.box/` schon selbst ab; die Probe maesse dann
 * Chromes Mixed-Content-Schutz statt unserer Regel.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Diese Probe braucht Playwright. Einmalig einrichten:\n');
  console.error('  npm install --no-save playwright');
  console.error('  npx playwright install chromium\n');
  process.exit(2);
}

const HIER = dirname(fileURLToPath(import.meta.url));

// Die Koederseite laeuft ueber HTTP. Von einer HTTPS-Seite aus weist Chrome
// eine Anfrage an `http://fritz.box/` schon selbst ab (mixed content) - dann
// misst die Probe Chromes Schutz statt unserer Regel.
const server = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>Koeder</title><h1>Eine Seite, die schnueffelt</h1>');
});
const port = await new Promise((f) => server.listen(0, '127.0.0.1', () => f(server.address().port)));
const ERW = resolve(HIER, '..', '..', 'dist', 'chromium');
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const proben = [];
const pruefe = (n, e, g) => proben.push({ n, e, g, gut: String(e) === String(g) });

const browser = await chromium.launchPersistentContext('', {
  executablePath: CHROME, headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    `--disable-extensions-except=${ERW}`,
    `--load-extension=${ERW}`,
    `--host-resolver-rules=MAP seite.koeder.test 127.0.0.1:${port},MAP fritz.box 127.0.0.1:${port},MAP router.asus.com 127.0.0.1:${port}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
try {
  let arbeiter = browser.serviceWorkers()[0];
  if (!arbeiter) { try { arbeiter = await browser.waitForEvent('serviceworker', { timeout: 25000 }); } catch { arbeiter = null; } }
  pruefe('Erweiterung laedt ueberhaupt', true, Boolean(arbeiter));

  const seite = await browser.newPage();
  const fehler = new Map();
  seite.on('requestfailed', (r) => fehler.set(r.url(), r.failure()?.errorText));
  await seite.waitForTimeout(4000);

  // Ein bekannter Werbehost beweist, dass die Regelsaetze WIRKLICH aktiv sind.
  // Ohne diese Probe koennte Chrome sie still abgewiesen haben.
  await seite.goto(`http://seite.koeder.test:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const werbung = 'https://pagead2.googlesyndication.com/pagead/probe.js';
  await seite.evaluate((u) => fetch(u, { mode: 'no-cors', signal: AbortSignal.timeout(4000) }).catch(() => {}), werbung);
  pruefe('Regelsaetze sind aktiv', 'net::ERR_BLOCKED_BY_CLIENT', fehler.get(werbung) ?? 'durch');

  // Der eigentliche Zweck: eine fremde Seite fragt das Heimnetz ab.
  for (const ziel of ['http://192.168.1.1/', 'http://10.0.0.1/', 'http://fritz.box/', 'http://router.asus.com/']) {
    await seite.evaluate((u) => fetch(u, { mode: 'no-cors', signal: AbortSignal.timeout(4000) }).catch(() => {}), ziel);
    pruefe(`fremde Seite -> ${ziel.replace('http://','').replace('/','')}`, 'net::ERR_BLOCKED_BY_CLIENT', fehler.get(ziel) ?? 'DURCH');
  }
  // GEGENPROBE, und die zaehlt am meisten: Wer selbst entwickelt, ruft den
  // eigenen Server auf 127.0.0.1 auf. Blockte die Liste den mit, waere sie
  // unbrauchbar - und der Fehler fiele erst dem Nutzer auf, nicht uns.
  const eigen = await browser.newPage();
  const fehlerE = new Map();
  eigen.on('requestfailed', (r) => fehlerE.set(r.url(), r.failure()?.errorText));
  const eigeneSeite = `http://127.0.0.1:${port}/`;
  const geladen = await eigen.goto(eigeneSeite, { timeout: 20000 }).then((r) => r.status() < 400).catch(() => false);
  pruefe('eigener Server auf 127.0.0.1 laedt', true, geladen);

  // Und aus der eigenen Seite heraus weiter auf sich selbst - das ist der
  // Fall `domain=~localhost` aus der Liste.
  const selbst = `http://127.0.0.1:${port}/api`;
  await eigen.evaluate((u) => fetch(u, { mode: 'no-cors', signal: AbortSignal.timeout(4000) }).catch(() => {}), selbst);
  pruefe('von 127.0.0.1 auf sich selbst', 'kein Block', fehlerE.get(selbst) ?? 'kein Block');
} finally { await browser.close(); server.close(); }

for (const p of proben) console.log(`  ${p.gut ? '✓' : '✗'} ${p.n.padEnd(36)} erwartet ${String(p.e).padEnd(26)} gemessen ${p.g}`);
const schlecht = proben.filter((p) => !p.gut).length;
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exit(schlecht === 0 ? 0 : 1);
