#!/usr/bin/env node
/**
 * Die Optionsseite an der GELADENEN Erweiterung: prueft den Bau, den die
 * Testreihe nicht sehen kann, und legt Bildschirmfotos daneben.
 *
 *     npm run probe:optionen
 *     npm run probe:optionen -- --bilder=/pfad     # wohin die Fotos sollen
 *
 * Warum ueberhaupt: `npm test` sieht `.tsx` nie (Node streift Typen ab, JSX
 * nicht), `npm run typecheck` sieht Typen und keine Pixel. Zwischen beidem
 * liegt genau die Sorte Fehler, die diese Seite schon hatte - eine Karte in
 * der Karte, ein Satz achtzehnmal untereinander, ein Aufklapper ohne
 * waagerechten Rand. Nichts davon faellt in einem Test um.
 *
 * Die Proben sind bewusst STRUKTUR und kein Pixelvergleich: Ein Vergleichsbild
 * schlaegt bei jeder Schriftaktualisierung des Systems fehl und wird dann
 * blind nachgezogen, bis es nichts mehr prueft.
 *
 * Braucht `dist/chromium` (also `npm run build:chromium`) und laeuft mit
 * `headless: false` - eine MV3-Erweiterung mit Service Worker startet in der
 * alten Kopflos-Betriebsart nicht.
 */
import { rmSync, mkdirSync } from 'node:fs';

const { chromium } = await import(new URL('../../node_modules/playwright/index.mjs', import.meta.url).href);

const ERW = new URL('../../dist/chromium', import.meta.url).pathname;
const CHROME =
  process.env.ADSILENCE_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

function argument(name, vorgabe) {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : vorgabe;
}
const BILDER = argument('bilder', new URL('../../.probe-optionen', import.meta.url).pathname);

const proben = [];
const pruefe = (name, erwartet, gemessen) =>
  proben.push({ name, erwartet, gemessen, gut: String(erwartet) === String(gemessen) });

const profil = new URL('../../.probe-profil-optionen', import.meta.url).pathname;
rmSync(profil, { recursive: true, force: true });
mkdirSync(BILDER, { recursive: true });

const browser = await chromium.launchPersistentContext(profil, {
  executablePath: CHROME,
  headless: false,
  viewport: { width: 1000, height: 1000 },
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`, '--no-first-run', '--no-default-browser-check'],
});

try {
  /*
   * Die Testphase-Pille braucht `trialDays > 0`. Was der ECHTE Server
   * zurueckgibt, ist eine Frage der Verwaltung und keine des Codes - steht
   * dort 0, gaebe es hier nichts zu sehen und die Probe pruefte nichts.
   * Deshalb antwortet `/api/plans` fuer diesen Lauf mit sieben Tagen: Geprueft
   * wird die DARSTELLUNG, nicht der Datenbestand.
   */
  await browser.route('**/api/plans*', async (route) => {
    const antwort = await route.fetch();
    const daten = await antwort.json();
    for (const p of daten.plans ?? []) p.trialDays = 7;
    await route.fulfill({ json: daten });
  });

  const sw = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker', { timeout: 60000 }));
  const id = new URL(sw.url()).host;

  const seite = await browser.newPage();
  await seite.goto(`chrome-extension://${id}/optionen/index.html`);
  await seite.waitForSelector('.liste__zeile', { timeout: 20000 });

  // ── Reiter ───────────────────────────────────────────────────────────────
  const reiter = await seite.$$eval('.nav__eintrag', (n) => n.map((b) => b.textContent.trim()));
  pruefe('zwei Reiter, nicht mehr', 2, reiter.length);

  // ── Filterlisten: kein Eigenname einer Quelle ────────────────────────────
  await seite.waitForTimeout(400);
  await seite.screenshot({ path: `${BILDER}/1-filterlisten.png`, fullPage: true });

  const NAMEN = /EasyList|EasyPrivacy|uBlock filters|Peter Lowe|Fanboy|YousList|ABPVN|ABPindo|Frellwit|IndianList|Liste FR/i;
  const sichtbar = () => seite.evaluate(() => document.body.innerText);
  pruefe('kein Quellname im Reiter Filterlisten', false, NAMEN.test(await sichtbar()));

  // ── Der Tipp am „i" ──────────────────────────────────────────────────────
  await seite.hover('.tipp');
  await seite.waitForTimeout(350);
  pruefe('der Tipp wird beim Zeigen sichtbar', '1', await seite.$eval('.tipp__text', (e) => getComputedStyle(e).opacity));
  await seite.screenshot({ path: `${BILDER}/2-tipp.png` });

  // ── Einstellungen: EINE Karte, vier Aufklapper ───────────────────────────
  await seite.click('.nav__eintrag:nth-child(2)');
  await seite.waitForSelector('.aufklapper', { timeout: 10000 });
  pruefe('genau eine Karte im Reiter Einstellungen', 1, await seite.$$eval('.liste', (n) => n.length));
  pruefe('vier Aufklappzeilen', 4, await seite.$$eval('.aufklapper', (n) => n.length));
  await seite.screenshot({ path: `${BILDER}/3-einstellungen-zu.png`, fullPage: true });

  for (const k of await seite.$$('.aufklapper')) await k.click();
  await seite.waitForTimeout(500);
  await seite.screenshot({ path: `${BILDER}/4-einstellungen-offen.png`, fullPage: true });
  pruefe('kein Quellname im Reiter Einstellungen', false, NAMEN.test(await sichtbar()));
  // Keine Karte in der Karte: die Sprachliste im Aufklapper traegt keinen
  // eigenen Schatten (Weiss auf Weiss mit Schatten dazwischen).
  const schatten = await seite.$eval('.aufklapper__inhalt .liste', (e) => getComputedStyle(e).boxShadow);
  pruefe('die Liste im Aufklapper hat keinen eigenen Schatten', 'none', schatten);

  // ── Kauffenster: der Knopf nimmt den Druck an ────────────────────────────
  await seite.click('.nav__eintrag:nth-child(1)');
  await seite.click('.liste__zeile--kauf');
  await seite.waitForSelector('.dialog .knopf--primaer', { timeout: 15000 });
  pruefe('„Premium holen" ist nicht ausgegraut', false, await seite.isDisabled('.dialog .knopf--primaer'));
  pruefe(
    'die Testphase steht unter dem Preis, mit der Zahl vom Server',
    '7 Tage kostenlos testen',
    await seite.$eval('.kauf__testphase', (e) => e.textContent.trim()).catch(() => 'fehlt'),
  );
  await seite.click('.dialog .knopf--primaer');
  await seite.waitForTimeout(300);
  pruefe('ohne Haken wird die Hakenzeile rot', true, Boolean(await seite.$('.haken--fehlt')));
  await seite.screenshot({ path: `${BILDER}/5-kauffenster.png` });
} finally {
  await browser.close();
  rmSync(profil, { recursive: true, force: true });
  // `_metadata/` legt CHROME beim Laden in `dist/chromium` an - maschinen-
  // spezifisch und im Web Store ein reservierter Name. Es muss weg, sonst
  // misst `pruefe-paket.mjs` danach 198 Dateien statt 166 (gemessen).
  rmSync(new URL('../../dist/chromium/_metadata', import.meta.url).pathname, { recursive: true, force: true });
}

console.log('');
for (const p of proben) console.log(`${p.gut ? 'OK  ' : 'FEHL'} ${p.name}: erwartet ${p.erwartet}, gemessen ${p.gemessen}`);
const schlecht = proben.filter((p) => !p.gut).length;
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden. Bilder: ${BILDER}`);
process.exitCode = schlecht ? 1 : 0;
