#!/usr/bin/env node
/**
 * Laeuft das Scriptlet FRUEH GENUG?
 *
 * ── Was diese Probe von `koeder-probe.mjs` unterscheidet ──────────────────
 * Die Koederprobe fragt, OB ein Scriptlet greift: Sie liest am Ende
 * `typeof window.blockAdBlock` und ist zufrieden, wenn dort `function` steht.
 * Das beantwortet die falsche Frage. Ein Scriptlet, das eine Millisekunde nach
 * dem Erkennungsskript der Seite greift, steht in dieser Messung genauso da
 * wie eines, das rechtzeitig war — und ist trotzdem wirkungslos.
 *
 * Hier wird deshalb gemessen, WANN: Das erste Skript der Testseite haelt fest,
 * ob die Falle zu diesem Zeitpunkt schon stand (`__probe.scriptletVorher`).
 * Genau das entscheidet, ob eine Seite „Adblock erkannt" zeigt oder nicht.
 *
 * ── Warum zweimal gemessen wird ───────────────────────────────────────────
 * Der alte Weg (`executeScript` bei `webNavigation.onCommitted`) ist ein
 * Wettlauf: Ein WACHER Service Worker gewinnt ihn fast immer, ein schlafender
 * fast nie. Wer nur einmal misst, misst also den Zustand des Workers, nicht
 * den des Codes.
 *
 * Der KALTE Lauf ist der ehrliche: erste Seite direkt nach dem Browserstart,
 * ohne Aufwaermen. Der WARME Lauf zeigt den freundlichen Fall. Beim
 * registrierten Weg muessen BEIDE gruen sein — der Browser laedt das Skript
 * dann selbst, ohne den Worker zu fragen.
 *
 * ── Die vier Detektoren ───────────────────────────────────────────────────
 * Nachgebaut sind die Muster, mit denen echte Seiten pruefen: ein
 * Koederelement, ein Werbeskript mit `onerror`, ein `fetch` auf eine
 * Zaehladresse, und die Falle selbst. Sie duerfen ruhig anschlagen — ein
 * Blocker, der nichts blockt, wird auch nicht erkannt. Sie stehen hier, weil
 * ihre Ergebnisse in den Bericht gehoeren: Sie sagen, WORAN eine Seite uns
 * erkennen wuerde, wenn das Scriptlet zu spaet kommt.
 *
 *     node tests/laufzeit/erkennung-probe.mjs [pfad-zu-dist/chromium]
 *
 * Rueckgabe 0 = beide Laeufe haben die Falle rechtzeitig gesetzt.
 */
import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Playwright ist absichtlich keine Abhaengigkeit dieses Pakets (siehe
// koeder-probe.mjs). Wer die Probe fahren will, holt ihn sich.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Diese Probe braucht Playwright. Einmalig einrichten:\n');
  console.error('  npm install --no-save playwright');
  console.error('  npx playwright install chromium\n');
  console.error('Danach: npm run probe:erkennung');
  process.exit(2);
}

const HIER = dirname(fileURLToPath(import.meta.url));
const ERWEITERUNG = resolve(process.argv[2] ?? join(HIER, '..', '..', 'dist', 'chromium'));

/*
 * Die Testseite laeuft unter `12thman.com`, weil fuer genau diese Domain in
 * `uBlock filters` eine Scriptlet-Regel steht:
 *
 *     12thman.com##+js(set-constant, blockAdBlock, trueFunc)
 *
 * Eine erfundene Domain haette kein Scriptlet — dort waere nichts zu messen,
 * und zwar bei jedem Blocker.
 */
const DOMAIN = '12thman.com';

/** Was der Werbeserver zu sehen bekommen hat. */
const angefragt = [];

const server = createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (host !== DOMAIN) {
    angefragt.push(`${host}${req.url}`);
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end('window.__werbungGeladen = true;');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    // Kein Zwischenspeicher: Der zweite Lauf soll dieselbe Seite frisch holen,
    // nicht eine, die schon im Speicher liegt.
    'cache-control': 'no-store',
  });
  res.end(readFileSync(join(HIER, '..', 'erkennung', 'index.html'), 'utf8'));
});

const proben = [];
const pruefe = (name, erwartet, gemessen, hinweis) =>
  proben.push({ name, erwartet, gemessen, hinweis, gut: String(erwartet) === String(gemessen) });

const port = await new Promise((fertig) => {
  server.listen(0, '127.0.0.1', () => fertig(server.address().port));
});

const CHROME = process.env.ADSILENCE_CHROME;

/*
 * Ein FESTES Profil, kein Wegwerfprofil.
 *
 * Registrierte Inhaltsskripte werden mit `persistAcrossSessions: true`
 * angemeldet: Sie ueberleben den Neustart des Browsers, und der Browser
 * injiziert sie beim naechsten Mal, BEVOR der Service Worker ueberhaupt
 * anlaeuft. Genau das ist der Alltag eines Kunden — installiert wird einmal,
 * gestartet wird tausendmal.
 *
 * Mit einem Wegwerfprofil waere jeder Lauf eine Erstinstallation, und die
 * Probe maesse nur den einen Zustand, den es genau einmal gibt.
 */
const PROFIL = join(HIER, '..', '..', '.probe-profil-erkennung');
rmSync(PROFIL, { recursive: true, force: true });

const startOptionen = {
  ...(CHROME ? { executablePath: CHROME } : {}),
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: [
    `--disable-extensions-except=${ERWEITERUNG}`,
    `--load-extension=${ERWEITERUNG}`,
    `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1:${port},MAP pagead2.googlesyndication.com 127.0.0.1:${port},MAP www.google-analytics.com 127.0.0.1:${port}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
  ],
};

let browser = await chromium.launchPersistentContext(PROFIL, startOptionen);

/**
 * Ab wann meldet der Hintergrund wieder registrierte Scriptlet-Skripte?
 * Gibt die Millisekunden seit dem Start zurueck, oder null.
 */
async function messeRegistrierung(ktx, wieLange) {
  const start = Date.now();
  let worker = ktx.serviceWorkers()[0];
  while (!worker && Date.now() - start < wieLange) {
    worker = await ktx.waitForEvent('serviceworker', { timeout: 2000 }).catch(() => null);
  }
  if (!worker) return null;
  while (Date.now() - start < wieLange) {
    const anzahl = await worker
      .evaluate(async () => {
        const alle = await chrome.scripting.getRegisteredContentScripts();
        return alle.filter((s) => s.id.startsWith('adsilence-scriptlets')).length;
      })
      .catch(() => 0);
    if (anzahl > 0) return Date.now() - start;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/** Eine Runde: Seite laden, warten bis gemessen, Ergebnis holen. */
async function messe() {
  const seite = await browser.newPage();
  try {
    await seite.goto(`http://${DOMAIN}:${port}/`, { waitUntil: 'load' });
    // Auf den Fertig-Merker der Seite warten statt auf gut Glueck.
    // Auf die SPAETE Messung warten (2 s), nicht nur auf die bei 400 ms:
    // Sonst laesst sich "greift gar nicht" nicht von "greift zu spaet"
    // unterscheiden, und beides sieht im Bericht gleich aus.
    await seite.waitForFunction(() => window.__probe && window.__probe.spaetFertig === true, null, {
      timeout: 8000,
    }).catch(() => undefined);
    return await seite.evaluate(() => window.__probe ?? null);
  } finally {
    await seite.close();
  }
}

let warm = null;
try {
  /*
   * ERSTINSTALLATION: die allererste Seite, bevor die Registrierung ueberhaupt
   * gelaufen ist. Ein einmaliger Zustand — er wird gemessen und BERICHTET,
   * aber er ist keine Bestehensbedingung: Die Registrierung braucht einen
   * Speicherzugriff, und der ist nun einmal asynchron.
   */
  const erst = await messe();
  const erstGut = erst ? erst.scriptletVorher : false;

  /*
   * WARM: derselbe Test, nachdem der Worker sicher laeuft und registriert hat.
   */
  await new Promise((f) => setTimeout(f, 3000));
  warm = await messe();
  pruefe(
    'WARM — Falle stand vor dem ersten Seitenskript',
    true,
    warm ? warm.scriptletVorher : 'keine Messung',
    'Rot heisst: auch mit wachem Worker zu spaet. Dann ist der Weg falsch, nicht das Timing.',
  );

  /*
   * NEUSTART — der Fall, der im Alltag zaehlt.
   *
   * Der Browser wird geschlossen und mit DEMSELBEN Profil neu gestartet. Ein
   * mit `persistAcrossSessions: true` registriertes Inhaltsskript ist danach
   * schon angemeldet: Der Browser injiziert es, bevor der Service Worker
   * anlaeuft. Ein Kunde installiert einmal und startet tausendmal — DIESER
   * Lauf beschreibt seinen Alltag, nicht die Erstinstallation.
   */
  await browser.close();
  browser = await chromium.launchPersistentContext(PROFIL, startOptionen);
  const nachNeustart = await messe();
  pruefe(
    'NACH NEUSTART — Falle stand vor dem ersten Seitenskript',
    true,
    nachNeustart ? nachNeustart.scriptletVorher : 'keine Messung',
    'Das ist der Alltag: Browser auf, sofort losgeklickt. Rot heisst, dass ' +
      'persistAcrossSessions nicht traegt.',
  );

  /*
   * WIE GROSS ist die Luecke? Der Punkt oben sagt nur ja/nein, und er faellt
   * schon dann um, wenn die Registrierung Millisekunden zu spaet kommt. Fuer
   * eine Entscheidung braucht es die Zahl.
   *
   * Deshalb ein DRITTER Start, in dem nicht navigiert, sondern der Worker
   * gefragt wird: Ab wann meldet `getRegisteredContentScripts()` wieder
   * Eintraege? Getrennt gemessen, damit das Warten die Messung oben nicht
   * beschoenigt -- dort soll weiter sofort navigiert werden.
   *
   * GEMESSEN am 08.09.2026 in dieser Anordnung: 121, 135 und 197 ms. Die
   * Registrierung ueberlebt den Neustart also NICHT (Chrome behandelt eine
   * entpackt geladene Erweiterung bei jedem Start wie neu installiert), aber
   * sie wird in rund einer Zehntelsekunde wieder aufgebaut. Die Grenze steht
   * bei einer halben Sekunde: Darueber ist es kein Neuaufbau mehr, sondern
   * ein Fehler in unserer Kette.
   */
  await browser.close();
  browser = await chromium.launchPersistentContext(PROFIL, startOptionen);
  const latenz = await messeRegistrierung(browser, 10000);
  console.log(
    `\nRegistrierung nach Neustart: ${latenz === null ? 'nie' : `${latenz} ms`} ` +
      '(gemessen ohne Navigation)',
  );
  pruefe(
    'Die Registrierung steht binnen einer halben Sekunde wieder',
    true,
    latenz !== null && latenz <= 500,
    'Rot heisst: Der Worker baut sie nicht schnell genug wieder auf. Dann ' +
      'liegt es an unserer Kette, nicht am Browser.',
  );

  console.log(`\nErstinstallation (einmalig, nicht Bestehensbedingung): ${erstGut}`);

  // Zur Einordnung, nicht als Bestehensbedingung: Woran wuerde die Seite uns
  // erkennen? Das darf ruhig anschlagen — ein Blocker blockt eben.
  const d = (warm && warm.detektoren) || {};
  console.log('\nWoran eine Seite uns erkennen koennte:');
  console.log(`  Koederelement versteckt:      ${d.koederVersteckt}`);
  console.log(`  Werbeskript scheiterte:       ${d.skriptFehler}`);
  console.log(`  Zaehl-fetch scheiterte:       ${d.fetchFehler}`);
  if (warm) console.log(`  erstes Seitenskript bei:      ${Math.round(warm.zeitErstesSkript)} ms`);

  /*
   * Der zeitliche Verlauf. Er trennt die beiden Fehlerbilder:
   *
   *   nirgends gesetzt      -> das Scriptlet greift gar nicht (Liste aus,
   *                            Karte fehlt, Host passt nicht)
   *   erst spaet gesetzt    -> es greift, aber nach dem Detektor: der Wettlauf
   *
   * GEMESSEN am 08.09.2026 mit dem executeScript-Weg: false / false / true.
   */
  console.log('\nWann die Falle stand:');
  console.log(`  vor dem ersten Seitenskript:  ${warm ? warm.scriptletVorher : '?'}`);
  console.log(`  nach 400 ms:                  ${d.falleNach400ms}`);
  console.log(`  nach 2 s:                     ${d.falleNach2s}`);

  // Greift das Scriptlet ueberhaupt? Wenn schon das rot ist, ist nicht der
  // Zeitpunkt das Problem, sondern die Kette davor.
  pruefe(
    'Falle steht spaetestens nach 2 s',
    true,
    d.falleNach2s === true,
    'Rot heisst: das Scriptlet greift GAR NICHT. Erst das klaeren, dann den Zeitpunkt.',
  );
} finally {
  await browser.close();
  server.close();
  // Das Profil ist eine Wegwerfsache; es soll nicht im Repo liegen bleiben.
  rmSync(PROFIL, { recursive: true, force: true });
}

let schlecht = 0;
for (const p of proben) {
  if (!p.gut) schlecht++;
  console.log(`${p.gut ? 'OK  ' : 'FEHL'} ${p.name}: erwartet ${p.erwartet}, gemessen ${p.gemessen}`);
  if (!p.gut && p.hinweis) console.log(`     ${p.hinweis}`);
}
if (angefragt.length) console.log('Durchgekommen ist:', angefragt.join(', '));
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exit(schlecht ? 1 : 0);
