/**
 * Der Beweis fuer den Verwechslungswarner: Erscheint die Warnung auf einer
 * gefaelschten Adresse, und bleibt sie auf der echten aus?
 *
 *     node tests/laufzeit/warner-probe.mjs
 *
 * Die vier Hosts werden per --host-resolver-rules auf einen lokalen Server
 * umgebogen; es geht keine Anfrage ins Netz, und keine der echten Adressen
 * wird wirklich aufgerufen.
 *
 * Die letzte Probe ist die wichtigste: OHNE Premium muss es still bleiben,
 * auch wenn der Schalter an ist.
 *
 * `--offen` misst nichts, sondern laesst den Browser stehen: Premium und
 * Warner sind eingeschaltet, eine Uebersichtsseite verlinkt die vier
 * Testadressen. Zum Anschauen, nicht zum Pruefen.
 */
const OFFEN = process.argv.includes('--offen');
const { chromium } = await import(new URL('../../node_modules/playwright/index.mjs', import.meta.url).href);
import { createServer } from 'node:http';
const ERW = new URL('../../dist/chromium', import.meta.url).pathname;
/** Die Seite, die jede der Testadressen ausliefert. */
function seiteFuer(host) {
  if (host === 'probe.test') {
    const zeilen = [
      ['paypa1.com', 'Eins statt l - muss warnen'],
      ['paypal-login.xyz', 'Marke im fremden Namen - muss warnen'],
      ['xn--mazon-3ve.de', 'kyrillisches a in amazon.de - muss warnen'],
      ['amazon.de', 'die echte Adresse - darf NICHT warnen'],
      ['paypal.com', 'die echte Adresse - darf NICHT warnen'],
      ['tagesschau.de', 'voellig fremd - darf NICHT warnen'],
    ]
      .map(([h, was]) => `<li><a href="http://${h}:PORT/">${h}</a> <span>${was}</span></li>`)
      .join('');
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Verwechslungswarner ausprobieren</title>
      <style>
        body { font: 16px/1.6 system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; color: #14181f; }
        h1 { font-size: 26px; }
        li { margin: 12px 0; }
        a { font-family: ui-monospace, Menlo, monospace; font-size: 17px; }
        span { color: #5b6472; font-size: 14px; display: block; }
        p.hinweis { background: #eef1f5; padding: 14px 16px; border-radius: 10px; font-size: 14px; }
      </style></head><body>
      <h1>Verwechslungswarner ausprobieren</h1>
      <p class="hinweis">Keine dieser Adressen geht ins Netz. Alle vier zeigen auf diesen Rechner;
      der Browser wurde angewiesen, sie hierher umzuleiten.</p>
      <ul>${zeilen}</ul>
      </body></html>`;
  }
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${host}</title>
    <style>body { font: 16px/1.6 system-ui, sans-serif; max-width: 520px; margin: 64px auto; padding: 0 20px; }
    input { display:block; width:100%; padding:10px; margin:8px 0 16px; font-size:16px; }</style></head><body>
    <h1>Anmeldung</h1><p>Bitte melden Sie sich an.</p>
    <label>Benutzername<input></label><label>Passwort<input type="password"></label>
    <p><a href="http://probe.test:PORT/">zurueck zur Uebersicht</a></p></body></html>`;
}

const server = createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(seiteFuer(host).replaceAll('PORT', String(port)));
});
const port = await new Promise((f) => server.listen(0, '127.0.0.1', () => f(server.address().port)));
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launchPersistentContext('', {
  executablePath: CHROME, headless: false,
  ignoreDefaultArgs: ['--disable-extensions','--disable-component-extensions-with-background-pages'],
  args: [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`,
    `--host-resolver-rules=MAP paypal.com 127.0.0.1:${port},MAP paypa1.com 127.0.0.1:${port},MAP paypal-login.xyz 127.0.0.1:${port},MAP tagesschau.de 127.0.0.1:${port},MAP xn--mazon-3ve.de 127.0.0.1:${port},MAP amazon.de 127.0.0.1:${port},MAP probe.test 127.0.0.1:${port}`,
    '--no-first-run','--no-default-browser-check'],
});
const proben = [];
const pruefe = (name, erwartet, gemessen) => proben.push({ name, erwartet, gemessen, gut: String(erwartet) === String(gemessen) });
try {
  const sw = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker', { timeout: 15000 }));
  // Premium und Warner einschalten, so wie es ein zahlender Nutzer haette.
  // Warten, bis `einrichten()` beim Installieren seine Vorgaben geschrieben
  // hat. Wer frueher setzt, wird ueberschrieben - und misst dann den
  // Vorgabezustand statt des gewollten.
  await new Promise((f) => setTimeout(f, 1500));
  await sw.evaluate(async () => {
    const { einstellungen } = await chrome.storage.local.get('einstellungen');
    await chrome.storage.local.set({
      einstellungen: { ...einstellungen, aktiv: true, warnung: true },
      lizenz: { tarif: 'premium', premium: true, planKeys: ['premium'], gueltigBis: null, endetZumTermin: false, hinweis: null, geprueftAm: Date.now() },
    });
  });

  if (OFFEN) {
    const schau = await browser.newPage();
    await schau.goto(`http://probe.test:${port}/`);
    console.log('Der Browser bleibt offen. Premium und Warner sind eingeschaltet.');
    console.log('Klick die vier Adressen durch; Strg-C beendet.');
    await new Promise(() => {});
  }

  const seite = await browser.newPage();
  const sichtbar = async (adresse) => {
    await seite.goto(adresse, { waitUntil: 'load' });
    await seite.waitForTimeout(1800);
    return seite.evaluate(() => Boolean(document.getElementById('adsilence-verwechslungswarnung')));
  };

  pruefe('gefaelscht: paypa1.com warnt', true, await sichtbar(`http://paypa1.com:${port}/`));
  // Der gefaehrlichste Fall: kyrillisches a in `amazon.de`. Der Browser
  // liefert dem Skript `xn--mazon-3ve.de`; ohne Entschluesselung faellt es
  // durch, und genau hier kann der Nutzer die Faelschung am Namen nicht sehen.
  pruefe('gefaelscht: kyrillisches a in amazon.de warnt', true, await sichtbar(`http://xn--mazon-3ve.de:${port}/`));
  pruefe('gefaelscht: paypal-login.xyz warnt', true, await sichtbar(`http://paypal-login.xyz:${port}/`));
  pruefe('echt: paypal.com warnt NICHT', false, await sichtbar(`http://paypal.com:${port}/`));
  pruefe('fremd: tagesschau.de warnt NICHT', false, await sichtbar(`http://tagesschau.de:${port}/`));

  // Und ohne Premium muss es still bleiben, auch wenn der Schalter an ist.
  await sw.evaluate(async () => {
    const { lizenz } = await chrome.storage.local.get('lizenz');
    await chrome.storage.local.set({ lizenz: { ...lizenz, premium: false, tarif: 'frei' } });
  });
  pruefe('ohne Premium: keine Warnung', false, await sichtbar(`http://paypa1.com:${port}/`));
} finally {
  await browser.close();
  server.close();
}
for (const p of proben) console.log(`${p.gut ? 'OK  ' : 'FEHL'} ${p.name}: erwartet ${p.erwartet}, gemessen ${p.gemessen}`);
const schlecht = proben.filter((p) => !p.gut).length;
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exit(schlecht ? 1 : 0);
