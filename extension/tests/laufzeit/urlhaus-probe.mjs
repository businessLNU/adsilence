/**
 * Der Beweis fuer die Malware-Liste: Blockt sie auch den KLICK auf den Link?
 *
 * Zwei Dinge sind hier schon schiefgegangen und stehen deshalb als eigene
 * Probe da:
 *
 *   1. Ohne die Option `$all` wirft die Engine 80 % der Liste weg - gemessen
 *      7633 von 9533 Zeilen. Die Liste war eingebaut und tat fast nichts.
 *   2. `$all` allein genuegt nicht. Chrome nimmt `main_frame` von sich aus
 *      aus, sobald `resourceTypes` fehlt; die Typen muessen AUFGEZAEHLT sein.
 *      Vorher fiel dieselbe Adresse als `fetch` und lud als Seitenaufruf.
 *
 * Beides sah in der gebauten Datei richtig aus. Nur der Browser zeigt es.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const ERW = resolve(HIER, '..', '..', 'dist', 'chromium');
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const MALWARE_DATEI = 'https://150.co.il/rustdesk-1.2.3-2-x86_64.exe';
const MALWARE_HOST  = 'https://0022a601.pphost.net/x.js';
const HARMLOS       = 'https://example.com/';

const proben = [];
const pruefe = (n, e, g) => proben.push({ n, e, g, gut: String(e) === String(g) });

const browser = await chromium.launchPersistentContext('', {
  executablePath: CHROME, headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`, '--no-first-run', '--no-default-browser-check'],
});
try {
  try { await browser.waitForEvent('serviceworker', { timeout: 25000 }); } catch {}
  const seite = await browser.newPage();
  const fehler = new Map();
  seite.on('requestfailed', (r) => fehler.set(r.url(), r.failure()?.errorText));
  await seite.waitForTimeout(3500);
  await seite.goto(HARMLOS, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 1) eingebettete Anfrage auf eine $all-Adresse
  await seite.evaluate((u) => fetch(u, { mode: 'no-cors', signal: AbortSignal.timeout(5000) }).catch(() => {}), MALWARE_DATEI);
  pruefe('$all-Adresse als Ressource', 'net::ERR_BLOCKED_BY_CLIENT', fehler.get(MALWARE_DATEI) ?? 'durch');

  // 2) eingebettete Anfrage auf eine Hostzeile ohne $all
  await seite.evaluate((u) => fetch(u, { mode: 'no-cors', signal: AbortSignal.timeout(5000) }).catch(() => {}), MALWARE_HOST);
  pruefe('Hostzeile als Ressource', 'net::ERR_BLOCKED_BY_CLIENT', fehler.get(MALWARE_HOST) ?? 'durch');

  // 3) DER ENTSCHEIDENDE FALL: der Klick auf den Link, also eine Navigation.
  // Ziel ohne Dateiendung, sonst macht Chrome daraus einen Download statt
  // einer Navigation - und misst damit eine ganz andere Frage.
  const MALWARE_SEITE = 'https://acusense.ae/umbrella/';
  const navi = await seite.goto(MALWARE_SEITE, { timeout: 20000 }).then(() => 'geladen').catch((e) =>
    /ERR_BLOCKED_BY_CLIENT/.test(e.message) ? 'geblockt' : 'anderer Fehler: ' + e.message.split('\n')[0].slice(0, 60));
  pruefe('KLICK auf die Malware-Seite', 'geblockt', navi);

  // 3b) Und der Download? Chrome behandelt eine .exe-Adresse nicht als
  // Navigation. Gemessen wird deshalb, ob der Download ueberhaupt beginnt.
  const seiteD = await browser.newPage();
  let downloadKam = false;
  seiteD.on('download', () => { downloadKam = true; });
  const fehlerD = new Map();
  seiteD.on('requestfailed', (r) => fehlerD.set(r.url(), r.failure()?.errorText));
  await seiteD.goto(HARMLOS, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await seiteD.evaluate((u) => {
    const a = document.createElement('a');
    a.href = u; a.download = ''; document.body.appendChild(a); a.click();
  }, MALWARE_DATEI);
  await seiteD.waitForTimeout(6000);
  pruefe('Malware-DOWNLOAD startet nicht', false, downloadKam);

  // 4) Gegenprobe: eine harmlose Seite bleibt erreichbar
  const ok = await seite.goto(HARMLOS, { timeout: 20000 }).then((r) => r.status() < 400).catch(() => false);
  pruefe('harmlose Seite laedt weiterhin', true, ok);
} finally { await browser.close(); }

for (const p of proben) console.log(`  ${p.gut ? '✓' : '✗'} ${p.n.padEnd(34)} erwartet ${String(p.e).padEnd(26)} gemessen ${p.g}`);
const schlecht = proben.filter((p) => !p.gut).length;
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exit(schlecht === 0 ? 0 : 1);
