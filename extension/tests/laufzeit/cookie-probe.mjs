/**
 * Der Beweis fuer das automatische Beantworten von Cookie-Fenstern.
 *
 *     node tests/laufzeit/cookie-probe.mjs
 *
 * Drei nachgestellte Seiten: ein OneTrust-Fenster im ausgelieferten HTML, ein
 * nachgeladenes Cookiebot-Fenster, und eine BESTELLSEITE mit einem Knopf
 * „Akzeptieren", die nichts mit Cookies zu tun hat.
 *
 * Die dritte ist die wichtigste Probe: Ein Klick auf den falschen Knopf -
 * Kauf bestaetigen, AGB annehmen - waere schlimmer als jedes stehengebliebene
 * Fenster. Ebenso die letzten beiden: ausgeschaltet und ohne Premium darf
 * nichts passieren.
 */
const { chromium } = await import(new URL('../../node_modules/playwright/index.mjs', import.meta.url).href);
import { createServer } from 'node:http';
const ERW = new URL('../../dist/chromium', import.meta.url).pathname;

// Drei Seiten: ein echtes OneTrust-Fenster, ein nachgeladenes Cookiebot-
// Fenster, und eine Bestellseite mit einem Knopf „Akzeptieren", die NICHTS
// mit Cookies zu tun hat.
const SEITEN = {
  '/onetrust': `<div id="onetrust-banner-sdk"><button id="onetrust-accept-btn-handler">Alle akzeptieren</button>
     <button id="onetrust-reject-all-handler">Alle ablehnen</button></div>
     <script>for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => { document.title = 'geklickt:' + b.id; });</script>`,
  '/spaet': `<div id="halter"></div><script>
     setTimeout(() => { document.getElementById('halter').innerHTML =
       '<div id="CybotCookiebotDialog"><button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll">OK</button></div>';
       document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll')
         .addEventListener('click', () => { document.title = 'geklickt:cookiebot'; }); }, 1200);</script>`,
  '/bestellung': `<h1>Bestellung</h1><button id="agb">Akzeptieren</button><button id="kaufen">Kauf bestätigen</button>
     <script>for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => { document.title = 'geklickt:' + b.id; });</script>`,
};
const server = createServer((req, res) => {
  const pfad = (req.url ?? '/').split('?')[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>nichts</title></head><body>${SEITEN[pfad] ?? '<p>leer</p>'}</body></html>`);
});
const port = await new Promise((f) => server.listen(0, '127.0.0.1', () => f(server.address().port)));
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launchPersistentContext('', {
  executablePath: CHROME, headless: false,
  ignoreDefaultArgs: ['--disable-extensions','--disable-component-extensions-with-background-pages'],
  args: [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`, '--no-first-run','--no-default-browser-check'],
});
const proben = [];
const pruefe = (name, erwartet, gemessen) => proben.push({ name, erwartet, gemessen, gut: String(erwartet) === String(gemessen) });
try {
  const sw = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker', { timeout: 60000 }));
  await new Promise((f) => setTimeout(f, 2500));
  const setze = (antwort) => sw.evaluate(async (a) => {
    const { einstellungen } = await chrome.storage.local.get('einstellungen');
    await chrome.storage.local.set({
      einstellungen: { ...einstellungen, aktiv: true, cookieAntwort: a },
      lizenz: { tarif: 'premium', premium: true, planKeys: ['premium'], gueltigBis: null, endetZumTermin: false, hinweis: null, geprueftAm: Date.now() },
    });
  }, antwort);
  const seite = await browser.newPage();
  const titelNach = async (pfad, ms = 3000) => {
    await seite.goto(`http://127.0.0.1:${port}${pfad}`, { waitUntil: 'load' });
    await seite.waitForTimeout(ms);
    return seite.title();
  };

  await setze('annehmen');
  pruefe('OneTrust: nimmt an', 'geklickt:onetrust-accept-btn-handler', await titelNach('/onetrust'));
  pruefe('nachgeladenes Fenster wird auch getroffen', 'geklickt:cookiebot', await titelNach('/spaet', 4000));
  pruefe('Bestellseite bleibt unberuehrt', 'nichts', await titelNach('/bestellung'));

  await setze('ablehnen');
  pruefe('OneTrust: lehnt ab', 'geklickt:onetrust-reject-all-handler', await titelNach('/onetrust'));

  await setze('aus');
  pruefe('ausgeschaltet: kein Klick', 'nichts', await titelNach('/onetrust'));

  await setze('annehmen');
  await sw.evaluate(async () => {
    const { lizenz } = await chrome.storage.local.get('lizenz');
    await chrome.storage.local.set({ lizenz: { ...lizenz, premium: false, tarif: 'frei' } });
  });
  pruefe('ohne Premium: kein Klick', 'nichts', await titelNach('/onetrust'));
} finally { await browser.close(); server.close(); }
for (const p of proben) console.log(`${p.gut ? 'OK  ' : 'FEHL'} ${p.name}: erwartet ${p.erwartet}, gemessen ${p.gemessen}`);
const schlecht = proben.filter((p) => !p.gut).length;
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exitCode = schlecht ? 1 : 0;
