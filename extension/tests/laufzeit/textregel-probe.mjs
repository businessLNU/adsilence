#!/usr/bin/env node
/**
 * Versteckt der Textläufer das richtige Element - und NUR das?
 *
 *     npm run probe:textregel
 *
 * Die Einheitentests (tests/engine/textregeln.test.ts) prüfen das Zerlegen.
 * Diese Probe prüft die Kette, die sie nicht kennt: gebaute Liste → Paket →
 * Hintergrund → Nachricht → Inhaltsskript → verstecktes Element.
 *
 * Die Regel wird NICHT erfunden, sondern aus `prozedural/basis.json` des
 * gebauten Pakets genommen, und ihr Host per `--host-resolver-rules` auf
 * einen lokalen Server gebogen. Eine ausgedachte Regel würde nur prüfen, ob
 * die Probe zu sich selbst passt.
 *
 * Drei Fälle, und der zweite ist der wichtigere:
 *   1. Ein Element, das den Text trägt      → muss WEG sein
 *   2. Ein Element ohne den Text            → muss BLEIBEN
 *   3. Ein Element, das erst nach einer     → muss AUCH weg sein
 *      Sekunde eingehängt wird                (der Beobachter)
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const PAKET = join(WURZEL, 'dist', 'chromium');
const PROFIL = join(WURZEL, '.probe-profil-textregel');

// ── Eine echte Regel aus dem gebauten Paket suchen ────────────────────────
const karte = JSON.parse(readFileSync(join(PAKET, 'prozedural', 'basis.json'), 'utf8'));
const EINFACH = /^[a-zA-Z][a-zA-Z0-9 .#>_-]*$/;
let HOST = null;
let REGEL = null;
for (const [host, liste] of Object.entries(karte)) {
  for (const r of liste) {
    // Ein einfacher Selektor und ein Text ohne Sonderformen: Die Probe soll
    // den LÄUFER prüfen, nicht meine Fähigkeit, HTML zu erfinden.
    if (!EINFACH.test(r.wahl)) continue;
    if (r.text.startsWith('/') || r.text.length < 4 || r.text.length > 60) continue;
    HOST = host;
    REGEL = r;
    break;
  }
  if (REGEL) break;
}
if (!REGEL) {
  console.log('Keine einfach nachbaubare Regel in prozedural/basis.json gefunden.');
  console.log('`npm run listen:bauen && npm run build` gelaufen?');
  process.exit(2);
}
console.log(`Regel aus dem Paket: ${HOST} → ${JSON.stringify(REGEL)}\n`);

const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><title>Probe</title></head><body>
    <${tag()}${attribute()} id="trifft">${REGEL.text} und noch etwas</${tag()}>
    <${tag()}${attribute()} id="trifft-nicht">Etwas ganz anderes</${tag()}>
    <div id="spaeter"></div>
    <script>
      setTimeout(function () {
        var el = document.createElement('${tag()}');
        el.id = 'spaet';
        el.className = ${JSON.stringify(klassen().join(' '))};
        el.textContent = ${JSON.stringify(REGEL.text)} + ' spaeter eingehaengt';
        document.getElementById('spaeter').appendChild(el);
      }, 1000);
    </script>
  </body></html>`);
});

/** Das Element, das der Selektor treffen soll. `p`, `div.x` → `p`, `div`. */
function tag() {
  const m = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(REGEL.wahl);
  return m ? m[1] : 'div';
}

/** Die Klassen aus dem Selektor, damit das Element ihn wirklich trifft. */
function klassen() {
  return [...REGEL.wahl.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
}

function attribute() {
  const k = klassen();
  return k.length ? ` class="${k.join(' ')}"` : '';
}

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launchPersistentContext(PROFIL, {
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    `--disable-extensions-except=${PAKET}`,
    `--load-extension=${PAKET}`,
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

let fehler = 0;
const pruefe = (name, erwartet, gemessen, hinweis) => {
  const ok = erwartet === gemessen;
  if (!ok) fehler += 1;
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}: erwartet ${JSON.stringify(erwartet)}, gemessen ${JSON.stringify(gemessen)}`);
  if (!ok && hinweis) console.log(`     ${hinweis}`);
};

try {
  // Dem Worker Zeit geben, sonst misst man ihn beim Anlaufen.
  await new Promise((r) => setTimeout(r, 3000));
  const seite = await browser.newPage();
  await seite.goto(`http://${HOST}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await seite.waitForTimeout(3000);

  const stand = await seite.evaluate(() => {
    const sichtbar = (id) => {
      const el = document.getElementById(id);
      if (!el) return 'fehlt';
      return getComputedStyle(el).display !== 'none';
    };
    return { trifft: sichtbar('trifft'), trifftNicht: sichtbar('trifft-nicht'), spaet: sichtbar('spaet') };
  });

  pruefe('das Element MIT dem Text ist weg', false, stand.trifft, 'Der Läufer hat nicht gegriffen.');
  pruefe('das Element OHNE den Text ist noch da', true, stand.trifftNicht, 'Der Läufer versteckt zu viel.');
  pruefe('das spaeter eingehaengte Element ist weg', false, stand.spaet, 'Der MutationObserver greift nicht.');
} catch (e) {
  fehler += 1;
  console.log('FEHL Probe abgebrochen:', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
console.log(`\n${fehler === 0 ? 'Alle Proben bestanden.' : `${fehler} Probe(n) rot.`}`);
process.exit(fehler === 0 ? 0 : 1);
