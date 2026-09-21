/**
 * Der Beweis, dass die regionale Liste der Browsersprache von selbst angeht.
 *
 *     node tests/laufzeit/sprach-probe.mjs
 *
 * ── Warum nur EINE Sprache geprüft wird ────────────────────────────────────
 * `chrome.i18n.getUILanguage()` meldet die Sprache des BETRIEBSSYSTEMS, nicht
 * die, die `--lang` dem Browser mitgibt. GEMESSEN am 03.09.2026: Mit
 * `--lang=fr` und `--lang=ja` meldete der Browser weiterhin `de`. Ein Lauf
 * über mehrere Sprachen prüfte also viermal dasselbe und bestand dreimal
 * fälschlich nicht.
 *
 * Die Zuordnung Sprache → Liste prüft deshalb der Einheitstest
 * (`tests/hintergrund/regional.test.ts`), der `regionalFuerSprache()` direkt
 * mit `de`, `de-AT`, `fr`, `ja` und `th` fährt. Hier wird das gemessen, was
 * nur am laufenden Browser zu sehen ist: dass die Wahl beim Einrichten
 * WIRKLICH passiert, das Ruleset danach aktiv ist, und dass ein zweiter Start
 * die Entscheidung des Nutzers nicht überschreibt.
 */
const { chromium } = await import(new URL('../../node_modules/playwright/index.mjs', import.meta.url).href);
const ERW = new URL('../../dist/chromium', import.meta.url).pathname;
const CHROME =
  process.env.ADSILENCE_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const proben = [];
const pruefe = (name, erwartet, gemessen) => proben.push({ name, erwartet, gemessen, gut: String(erwartet) === String(gemessen) });

// Ein PERSISTENTES Profil, damit der zweite Start denselben Speicher sieht.
const profil = new URL('../../.probe-profil', import.meta.url).pathname;
const { rmSync } = await import('node:fs');
rmSync(profil, { recursive: true, force: true });

async function starte() {
  const browser = await chromium.launchPersistentContext(profil, {
    executablePath: CHROME, headless: false,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`, '--no-first-run', '--no-default-browser-check'],
  });
  const sw = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker', { timeout: 60000 }));
  await new Promise((f) => setTimeout(f, 3000));
  return { browser, sw };
}

async function stand(sw) {
  return sw.evaluate(async () => {
    const { einstellungen } = await chrome.storage.local.get('einstellungen');
    const aktiv = await chrome.declarativeNetRequest.getEnabledRulesets();
    return {
      sprache: chrome.i18n.getUILanguage(),
      gewaehlt: einstellungen?.listen ?? {},
      regionalAktiv: aktiv.filter((x) => x.startsWith('regional-')),
    };
  });
}

// ── Erster Start: die Liste zur Systemsprache geht von selbst an ───────────
let { browser, sw } = await starte();
const erst = await stand(sw);
const grund = String(erst.sprache).toLowerCase().split('-')[0];
const erwartet = `regional-${grund}`;
console.log(`Browser meldet "${erst.sprache}", erwartet also ${erwartet}`);
pruefe('die Liste der Browsersprache ist gewaehlt', true, Object.keys(erst.gewaehlt).includes(erwartet));
pruefe('und ihr Ruleset ist wirklich aktiv', true, erst.regionalAktiv.includes(erwartet));
pruefe('genau EINE regionale Liste, nicht alle', 1, erst.regionalAktiv.length);

// Der Nutzer schaltet sie ab.
await sw.evaluate(async (id) => {
  const { einstellungen } = await chrome.storage.local.get('einstellungen');
  await chrome.storage.local.set({ einstellungen: { ...einstellungen, listen: { ...einstellungen.listen, [id]: false } } });
}, erwartet);
await browser.close();

// ── Zweiter Start: die Entscheidung des Nutzers bleibt stehen ──────────────
({ browser, sw } = await starte());
const zweit = await stand(sw);
pruefe('nach dem Abschalten bleibt sie aus', false, zweit.gewaehlt[erwartet] === true);
pruefe('und ihr Ruleset ist auch aus', false, zweit.regionalAktiv.includes(erwartet));
await browser.close();
rmSync(profil, { recursive: true, force: true });

console.log('');
for (const p of proben) console.log(`${p.gut ? 'OK  ' : 'FEHL'} ${p.name}: erwartet ${p.erwartet}, gemessen ${p.gemessen}`);
const schlecht = proben.filter((p) => !p.gut).length;
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exitCode = schlecht ? 1 : 0;
