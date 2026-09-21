#!/usr/bin/env node
/**
 * Warum sagt der Tester „echter, wiedererkennbarer Fingerabdruck"?
 *
 *     npm run diagnose:fingerabdruck
 *
 * Keine Bestehensprobe, sondern eine Diagnose: Sie stellt drei Zustände
 * nacheinander her und misst nach jedem denselben Canvas-Hash. Damit trennt
 * sich, was am Zustand liegt, von dem, was am Code liegt.
 *
 *   1. wie frisch entpackt geladen      (kein Konto)
 *   2. Premium-Lizenz gesetzt           (Schalter unberuehrt)
 *   3. Premium UND Schalter ausdruecklich an
 *
 * GEMESSEN am 08.09.2026, nach der Umstellung auf „ab Werk an fuer Premium":
 *
 *   Stufe 1 (frei):     spaet = Grundwert   -> der Premium-Riegel haelt
 *   Stufe 2 (Premium):  spaet != Grundwert  -> Schutz ohne Zutun
 *
 * ZWEI ZEITPUNKTE, und das ist der Kern dieser Datei. Die Hauptwelt startet
 * mit Rauschen AN und einem gewuerfelten Seed; erst die Antwort des
 * Hintergrunds stellt das richtig - beim freien Nutzer auf AUS, beim
 * Premiumkunden auf den Seed der Seite. Eine einzelne Messung faellt je nach
 * Zeitpunkt anders aus, und genau daran ist die erste Fassung dieser
 * Diagnose gescheitert: Sie meldete fuer einen FREIEN Nutzer „verwischt".
 *
 * Das Fenster davor ist echt und bleibt: unter 1,2 s, und es gilt seit jeher
 * fuer jeden. Wer es schliessen will, muesste die Vorgabe der Hauptwelt auf
 * AUS drehen - dann liest eine Seite, die frueh misst, den ECHTEN Wert. Das
 * ist eine Abwaegung, keine Reparatur.
 */
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const PAKET = join(WURZEL, 'dist', 'chromium');
const PROFIL = join(WURZEL, '.probe-profil-fingerdiagnose');
const HOST = 'messung.test';

// Dieselbe Art Bild, an der ein Fingerabdrucker misst: Text mit Emoji,
// Verlauf, überlappende Bögen. Der Hash daraus ist der „Fingerabdruck".
const SEITE = `<!doctype html><html><head><title>Messung</title></head><body>
<canvas id="c" width="280" height="60"></canvas>
<script>
  window.hash = function () {
    var c = document.getElementById('c');
    var x = c.getContext('2d');
    x.textBaseline = 'top';
    x.font = '14px Arial';
    x.fillStyle = '#f60';
    x.fillRect(10, 1, 62, 20);
    x.fillStyle = '#069';
    x.fillText('AdSilence 😀', 2, 15);
    x.fillStyle = 'rgba(102, 204, 0, 0.7)';
    x.fillText('AdSilence 😀', 4, 17);
    var d = c.toDataURL();
    var h = 0;
    for (var i = 0; i < d.length; i++) { h = (h * 31 + d.charCodeAt(i)) | 0; }
    return String(h);
  };
</script>
</body></html>`;

const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(SEITE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const optionen = (mitErweiterung) => ({
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    ...(mitErweiterung ? [`--disable-extensions-except=${PAKET}`, `--load-extension=${PAKET}`] : []),
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

/**
 * Zweimal messen: frueh und spaet.
 *
 * Die Hauptwelt startet mit Rauschen AN (gewuerfelt) und hoert erst auf,
 * wenn das Inhaltsskript ihr `an: false` durchreicht - und das ist eine
 * Nachricht an den Hintergrund und zurueck. Wer nur einmal misst, kann einen
 * Wettlauf fuer eine Einstellung halten.
 */
async function hashVon(browser) {
  const seite = await browser.newPage();
  await seite.goto(`http://${HOST}/`, { waitUntil: 'load', timeout: 20000 });
  await seite.waitForTimeout(300);
  const frueh = await seite.evaluate(() => window.hash());
  await seite.waitForTimeout(4000);
  const spaet = await seite.evaluate(() => window.hash());
  await seite.close();
  return { frueh, spaet };
}

// ── Grundwert: derselbe Browser OHNE Erweiterung ──────────────────────────
const ohne = await chromium.launchPersistentContext(`${PROFIL}-ohne`, optionen(false));
const grundwert = (await hashVon(ohne)).spaet;
await ohne.close();
console.log(`Grundwert ohne Erweiterung: ${grundwert}\n`);

const browser = await chromium.launchPersistentContext(PROFIL, optionen(true));
try {
  let worker = browser.serviceWorkers()[0];
  if (!worker) worker = await browser.waitForEvent('serviceworker', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 3000));

  const zustand = () =>
    worker.evaluate(async () => {
      const s = await chrome.storage.local.get(['einstellungen', 'lizenz']);
      return {
        aktiv: s.einstellungen?.aktiv ?? null,
        schalter: s.einstellungen?.fingerabdruck ?? null,
        lizenz: s.lizenz ? { tarif: s.lizenz.tarif, premium: s.lizenz.premium } : null,
      };
    });

  const stufe = async (name) => {
    const z = await zustand();
    const h = await hashVon(browser);
    const urteil = (w) => (w === grundwert ? 'wie ohne Erweiterung (ECHT)' : 'abweichend (VERWISCHT)');
    console.log(
      `${name}\n` +
        `  Zustand: aktiv=${z.aktiv} schalter=${z.schalter} lizenz=${JSON.stringify(z.lizenz)}\n` +
        `  nach 0,3 s: ${h.frueh}  ${urteil(h.frueh)}\n` +
        `  nach 4,3 s: ${h.spaet}  ${urteil(h.spaet)}\n` +
        `${h.frueh !== h.spaet ? '  ACHTUNG: die beiden Messungen unterscheiden sich - ein Wettlauf.\n' : ''}`,
    );
    return h.spaet !== grundwert;
  };

  const s1 = await stufe('1. wie frisch entpackt geladen');

  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      lizenz: {
        tarif: 'premium',
        premium: true,
        planKeys: ['premium'],
        gueltigBis: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        endetZumTermin: false,
        hinweis: null,
        geprueftAm: Date.now(),
      },
    });
  });
  const s2 = await stufe('2. Premium-Lizenz gesetzt, Schalter unberuehrt');

  await worker.evaluate(async () => {
    const s = await chrome.storage.local.get(['einstellungen']);
    await chrome.storage.local.set({ einstellungen: { ...(s.einstellungen ?? {}), fingerabdruck: true } });
  });
  const s3 = await stufe('3. Premium UND Schalter an');

  console.log('── Urteil ──────────────────────────────────────────────────');
  if (!s1 && !s2 && s3) {
    console.log('Der rote Haken ist eine EINSTELLUNG, kein Fehler:');
    console.log('Premium allein reicht nicht - der Schalter „Fingerabdruck" muss an sein.');
  } else if (s3) {
    console.log(`Verwischt ab Stufe ${s1 ? 1 : 2}. Premium/Schalter wirken frueher als gedacht.`);
  } else {
    console.log('FEHLER: Auch mit Premium UND Schalter aendert sich der Hash nicht.');
    console.log('Dann liegt es nicht am Zustand. Naechster Blick: reicht der Hintergrund');
    console.log('`fingerabdruck.an: true` an das Inhaltsskript, und kommt es in der Hauptwelt an?');
  }
} catch (e) {
  console.log('Diagnose abgebrochen:', String(e).split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
