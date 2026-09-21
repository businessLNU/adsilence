/**
 * Nimmt Chrome eine IP-Adresse in `requestDomains` an — und blockt sie auch?
 *
 *     xvfb-run -a node tests/laufzeit/ip-domains-probe.mjs
 *
 * ── Warum diese Frage gestellt wird ───────────────────────────────────────
 * `urlhaus` fuehrt 1265 nackte IP-Zeilen. Als Teilstring-Muster kostet jede
 * eine eigene DNR-Regel; als Hostregel legt `zuDnr` sie mit den uebrigen zu
 * EINER Regel mit vielen `requestDomains` zusammen. Das spart Kontingent —
 * aber nur, wenn Chrome eine IPv4 dort ueberhaupt vergleicht. Nimmt es die
 * Regel an und trifft sie nie, waeren 1265 Schadadressen still ungeschuetzt,
 * und niemand saehe es.
 *
 * Deshalb drei Messungen an einem laufenden Browser:
 *   1. IP     — `requestDomains: ['127.0.0.1']` gegen eine echte IP-Anfrage
 *   2. Name   — dieselbe Regel auf einen Hostnamen (beweist die Messanlage)
 *   3. frei   — ohne Regel (beweist, dass ueberhaupt etwas durchkommt)
 *
 * Die Regeln sind SITZUNGSregeln: Sie leben nur im laufenden Browser und
 * fassen die dynamischen Regeln der Erweiterung nicht an.
 */
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';

const { chromium } = await import(
  new URL('../../node_modules/playwright/index.mjs', import.meta.url).href
);
const ERW = new URL('../../dist/chromium', import.meta.url).pathname;

const server = createServer((req, antwort) => {
  if (req.url?.startsWith('/ziel')) {
    antwort.writeHead(200, { 'content-type': 'text/plain' });
    antwort.end('ok');
    return;
  }
  antwort.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  antwort.end('<!doctype html><meta charset="utf-8"><title>ip-probe</title>');
});
await new Promise((f) => server.listen(0, '127.0.0.1', f));
const port = server.address().port;

/** Kommt die Datei an? `no-cors`: durchgelassen = opaque, geblockt = Fehler. */
const holen = (adresse) =>
  fetch(adresse, { mode: 'no-cors', cache: 'no-store' }).then(
    () => 'durchgelassen',
    () => 'geblockt',
  );

const browser = await chromium.launchPersistentContext('', {
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    `--disable-extensions-except=${ERW}`,
    `--load-extension=${ERW}`,
    `--host-resolver-rules=MAP probe.test 127.0.0.1:${port},MAP gesperrt.test 127.0.0.1:${port},MAP frei.test 127.0.0.1:${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
  ],
});

const proben = [];
const pruefe = (name, erwartet, gemessen) =>
  proben.push({ name, erwartet, gemessen, gut: erwartet === gemessen });

try {
  const sw =
    browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker', { timeout: 30000 }));
  await new Promise((f) => setTimeout(f, 1500));

  // Nimmt Chrome die Regel ueberhaupt an? Ein Wurf hier ist schon die Antwort.
  const angenommen = await sw.evaluate(async () => {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [
          {
            id: 9001,
            priority: 100,
            action: { type: 'block' },
            condition: { requestDomains: ['127.0.0.1'], resourceTypes: ['xmlhttprequest'] },
          },
          {
            id: 9002,
            priority: 100,
            action: { type: 'block' },
            condition: { requestDomains: ['gesperrt.test'], resourceTypes: ['xmlhttprequest'] },
          },
        ],
      });
      return 'angenommen';
    } catch (e) {
      return `abgelehnt: ${String(e).slice(0, 120)}`;
    }
  });
  pruefe('Chrome nimmt eine IPv4 in requestDomains an', 'angenommen', angenommen);

  const seite = await browser.newPage();
  await seite.goto(`http://probe.test:${port}/`);

  pruefe('IP-Adresse wird geblockt', 'geblockt', await seite.evaluate(holen, `http://127.0.0.1:${port}/ziel?a`));
  pruefe('Hostname wird geblockt', 'geblockt', await seite.evaluate(holen, `http://gesperrt.test:${port}/ziel?b`));
  pruefe('ohne Regel kommt es durch', 'durchgelassen', await seite.evaluate(holen, `http://frei.test:${port}/ziel?c`));
} finally {
  await browser.close();
  server.close();
}

let schlecht = 0;
for (const p of proben) {
  if (!p.gut) schlecht += 1;
  process.stdout.write(
    `${p.gut ? 'OK  ' : 'FEHL'}  ${p.name}\n        erwartet ${p.erwartet}, gemessen ${p.gemessen}\n`,
  );
}
process.stdout.write(`\n${proben.length - schlecht}/${proben.length} Proben gut\n`);
process.exitCode = schlecht ? 1 : 0;

// Chrome legt beim Laden einer ENTPACKTEN Erweiterung `_metadata/` im Ordner
// an (vorkompilierte Regelindizes). Beim naechsten Laden weist es denselben
// Ordner dann zurueck - Namen mit `_` sind reserviert -, und die Erweiterung
// steht in `chrome://extensions` abgeschaltet da. Wer misst, raeumt das weg.
rmSync(new URL('../../dist/chromium/_metadata', import.meta.url).pathname, { recursive: true, force: true });
