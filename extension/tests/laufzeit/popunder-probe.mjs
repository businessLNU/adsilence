#!/usr/bin/env node
/**
 * Schliesst der Popunder-Waechter den Tab — im ECHTEN Browser?
 *
 *     npm run probe:popunder
 *
 * Die Einheitentests (tests/hintergrund/popup.test.ts) pruefen die Logik an
 * einer Attrappe. Diese Probe prueft den Weg, den die Attrappe nicht kennt:
 * Feuert `webNavigation.onCreatedNavigationTarget` wirklich, kommt die
 * Hostliste aus dem Paket, und ist `tabs.remove` schneller als der Nutzer?
 *
 * Aufbau wie bei erkennung-probe: ein lokaler Server, und die Hosts werden
 * per `--host-resolver-rules` auf ihn umgebogen. Der Popunder-Host ist ein
 * ECHTER aus popup/basis.json (gemessen am 08.09.2026 auf aniworld.to:
 * cruzswim.org), damit die Probe die gebaute Liste prueft und nicht eine
 * erfundene. Ein zweiter, harmloser Host ist die Gegenprobe: Der muss OFFEN
 * bleiben, sonst schliesst der Waechter alles.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const PAKET = join(WURZEL, 'dist', 'chromium');
const PROFIL = join(WURZEL, '.probe-profil-popunder');

const liste = JSON.parse(readFileSync(join(PAKET, 'popup', 'basis.json'), 'utf8'));
const POPUNDER = liste.hosts.includes('cruzswim.org') ? 'cruzswim.org' : liste.hosts[0];
const HARMLOS = 'harmlos.test';
const START = 'start.test';

const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (req.headers.host?.startsWith(START)) {
    // Die Umleitungskette, wie sie auf aniworld.to gemessen wurde: ein
    // Zwischenhost, der per 302 auf den Popunder weiterreicht.
    if (req.url.startsWith('/weiter')) {
      res.statusCode = 302;
      res.setHeader('location', `http://${POPUNDER}/anzeige?key=2`);
      res.end();
      return;
    }
    res.end(`<!doctype html><title>Start</title>
      <button id="pop" onclick="window.open('http://${POPUNDER}/anzeige?key=1')">Popunder</button>
      <button id="um" onclick="window.open('http://${START}/weiter')">Umleitung</button>
      <button id="ok" onclick="window.open('http://${HARMLOS}/seite')">Harmlos</button>`);
    return;
  }
  res.end(`<!doctype html><title>${req.headers.host}</title><p>${req.headers.host}</p>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launchPersistentContext(PROFIL, {
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    `--disable-extensions-except=${PAKET}`,
    `--load-extension=${PAKET}`,
    `--host-resolver-rules=MAP ${START} 127.0.0.1:${port},MAP ${POPUNDER} 127.0.0.1:${port},MAP ${HARMLOS} 127.0.0.1:${port}`,
    '--no-sandbox', '--no-first-run', '--no-default-browser-check',
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
  let worker = browser.serviceWorkers()[0];
  if (!worker) worker = await browser.waitForEvent('serviceworker', { timeout: 15000 });
  const meldungen = [];
  worker.on('console', (m) => meldungen.push(`[${m.type()}] ${m.text()}`));
  await new Promise((r) => setTimeout(r, 3000));

  // ── Was der Worker selbst sagt ────────────────────────────────────────
  const zustand = await worker.evaluate(async (host) => {
    const m = chrome.runtime.getManifest();
    const st = await chrome.storage.local.get(['einstellungen']);
    const j = await (await fetch(chrome.runtime.getURL('popup/basis.json'))).json();
    return {
      lauscherZiel: chrome.webNavigation.onCreatedNavigationTarget.hasListeners(),
      lauscherCommit: chrome.webNavigation.onCommitted.hasListeners(),
      aktiv: st.einstellungen ? st.einstellungen.aktiv : '(keine Einstellungen gespeichert)',
      basisImManifest: (m.declarative_net_request?.rule_resources ?? []).some((r) => r.id === 'basis'),
      hosts: j.hosts.length,
      kenntHost: j.hosts.includes(host),
    };
  }, POPUNDER);
  console.log('\nZustand im Worker:', JSON.stringify(zustand));
  pruefe('Lauscher auf onCreatedNavigationTarget', true, zustand.lauscherZiel, 'registrierePopupWaechter() ist nie gelaufen.');
  pruefe('Hauptschalter an', true, zustand.aktiv === true || zustand.aktiv === '(keine Einstellungen gespeichert)');
  pruefe(`Paketliste kennt ${POPUNDER}`, true, zustand.kenntHost);

  // ── Der Popunder ──────────────────────────────────────────────────────
  const geoeffnet = [];
  browser.on('page', (p) => geoeffnet.push(p));
  const seite = await browser.newPage();
  geoeffnet.length = 0;
  await seite.goto(`http://${START}:${port}/`.replace(`:${port}`, ''), { waitUntil: 'load' });

  await seite.click('#pop');
  await new Promise((r) => setTimeout(r, 4000));
  const popTabs = browser.pages().filter((p) => p.url().includes(POPUNDER));
  pruefe('der Popunder-Tab wurde ueberhaupt aufgemacht', true, geoeffnet.length >= 1, 'window.open kam nicht durch -- dann misst die Probe nichts.');
  pruefe(`der Tab auf ${POPUNDER} ist wieder ZU`, 0, popTabs.length, 'Der Waechter hat ihn nicht geschlossen.');

  // ── Die Umleitungskette ───────────────────────────────────────────────
  const vorher = geoeffnet.length;
  await seite.click('#um');
  await new Promise((r) => setTimeout(r, 4000));
  const umTabs = browser.pages().filter((p) => p.url().includes(POPUNDER) || p.url().includes('/weiter'));
  pruefe('der umgeleitete Tab wurde aufgemacht', true, geoeffnet.length > vorher);
  pruefe(`der Tab, der ueber ${START}/weiter auf ${POPUNDER} landet, ist wieder ZU`, 0, umTabs.length,
    'Der Waechter prueft nur die erste Adresse -- die Umleitung sieht er nicht.');

  // ── Die Gegenprobe ────────────────────────────────────────────────────
  await seite.click('#ok');
  await new Promise((r) => setTimeout(r, 3000));
  const okTabs = browser.pages().filter((p) => p.url().includes(HARMLOS));
  pruefe(`der Tab auf ${HARMLOS} bleibt OFFEN`, 1, okTabs.length, 'Der Waechter schliesst auch, was er nicht schliessen darf.');

  if (meldungen.length) console.log('\nKonsole des Workers:\n  ' + meldungen.slice(-10).join('\n  '));
} catch (e) {
  fehler += 1;
  console.log('FEHL Probe abgebrochen:', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
console.log(`\n${fehler === 0 ? 'Alle Proben bestanden.' : `${fehler} Probe(n) rot.`}`);
process.exit(fehler === 0 ? 0 : 1);
