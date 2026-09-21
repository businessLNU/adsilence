#!/usr/bin/env node
/**
 * Wie viele statische Regeln laedt Chrome WIRKLICH?
 *
 * ── Warum das gemessen werden muss ────────────────────────────────────────
 * Chrome nennt 30.000 als „guaranteed minimum" fuer aktivierte statische
 * Regelsaetze. Das klingt nach Obergrenze und ist keine: Darueber bedient
 * sich eine Erweiterung aus einem Pool, den sich alle installierten
 * Erweiterungen teilen. Ob die Regeln ueber 30.000 geladen werden, haengt
 * also davon ab, was sonst noch installiert ist -- und das steht in keiner
 * Datei, das sagt nur der laufende Browser.
 *
 * GEMESSEN am 08.09.2026 an den Paketen der Konkurrenz: AdGuard faehrt mit
 * 71.148 aktiven Regeln, uBlock Origin Lite mit 18.534. Die Zahl 30.000 ist
 * also weder Grenze noch Richtwert.
 *
 * ── Was diese Probe beantwortet ──────────────────────────────────────────
 * `getAvailableStaticRuleCount()` sagt, wie viele Regeln die Erweiterung noch
 * zusaetzlich aktivieren duerfte. `getEnabledRulesets()` sagt, welche
 * Regelsaetze tatsaechlich geladen sind -- fehlt einer, den das Manifest auf
 * `enabled` stellt, hat Chrome ihn stillschweigend verworfen. Genau das ist
 * der Fehler, den man sonst erst beim Kunden sieht.
 *
 * Aufruf: node tests/laufzeit/regelbudget-probe.mjs [dist/chromium]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ORDNER = resolve(process.argv[2] ?? join(WURZEL, 'dist', 'chromium'));

if (!existsSync(join(ORDNER, 'manifest.json'))) {
  console.error(`Kein Paket unter ${ORDNER}. Erst \`npm run build:chromium\` fahren.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(ORDNER, 'manifest.json'), 'utf8'));
const saetze = manifest.declarative_net_request?.rule_resources ?? [];
const sollAn = saetze.filter((r) => r.enabled);

/** Was im Paket steht -- die Erwartung, gegen die gemessen wird. */
let regelnSollAn = 0;
for (const satz of sollAn) {
  const datei = join(ORDNER, satz.path.replace(/^\//, ''));
  if (!existsSync(datei)) continue;
  const inhalt = JSON.parse(readFileSync(datei, 'utf8'));
  if (Array.isArray(inhalt)) regelnSollAn += inhalt.length;
}

console.log(`Paket:            ${ORDNER}`);
console.log(`Regelsaetze:      ${saetze.length}, davon ab Werk an: ${sollAn.length}`);
console.log(`Regeln ab Werk:   ${regelnSollAn.toLocaleString('de-DE')}`);
console.log();

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'Playwright fehlt.\n' +
      '  npm i --no-save playwright && npx playwright install chromium',
  );
  process.exit(1);
}

/*
 * `headless: false` und dazu `ignoreDefaultArgs` -- beides noetig, damit die
 * Erweiterung ueberhaupt laedt.
 *
 * Im Headless-Modus laeuft der Service Worker nicht an, und Playwright
 * startet Chrome ausserdem mit `--disable-extensions`. Ohne Bildschirm hilft
 * `xvfb-run`; genau so machen es die anderen Laufzeitproben in diesem Ordner.
 */
const browser = await chromium.launchPersistentContext('', {
  headless: false,
  ignoreDefaultArgs: [
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
  ],
  args: [
    `--disable-extensions-except=${ORDNER}`,
    `--load-extension=${ORDNER}`,
    '--no-sandbox',
  ],
});

/** Der Service Worker der Erweiterung -- er kann `chrome.declarativeNetRequest`. */
async function serviceWorker() {
  for (let i = 0; i < 40; i += 1) {
    const gefunden = browser.serviceWorkers()[0];
    if (gefunden) return gefunden;
    await new Promise((f) => setTimeout(f, 500));
  }
  return null;
}

const sw = await serviceWorker();
if (!sw) {
  console.error('Der Service Worker ist nicht angelaufen — ohne ihn ist nichts zu messen.');
  await browser.close();
  process.exit(1);
}

const messung = await sw.evaluate(async () => {
  const dnr = chrome.declarativeNetRequest;
  const [aktiv, frei] = await Promise.all([
    dnr.getEnabledRulesets(),
    dnr.getAvailableStaticRuleCount(),
  ]);
  return { aktiv, frei, grenzen: {
    regelsaetze: dnr.MAX_NUMBER_OF_STATIC_RULESETS,
    aktivierte: dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS,
    garantiert: dnr.GUARANTEED_MINIMUM_STATIC_RULES,
    dynamisch: dnr.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES,
  } };
});

await browser.close();

console.log('Was Chrome selbst sagt:');
console.log(`  Regelsaetze hoechstens:        ${messung.grenzen.regelsaetze}`);
console.log(`  davon aktiviert hoechstens:    ${messung.grenzen.aktivierte}`);
console.log(`  garantierte statische Regeln:  ${messung.grenzen.garantiert?.toLocaleString('de-DE')}`);
console.log(`  dynamische Regeln hoechstens:  ${messung.grenzen.dynamisch?.toLocaleString('de-DE')}`);
console.log();
console.log(`Geladen:          ${messung.aktiv.length} Regelsaetze`);
console.log(`Noch frei:        ${messung.frei.toLocaleString('de-DE')} statische Regeln`);
console.log();

const fehlend = sollAn.map((r) => r.id).filter((id) => !messung.aktiv.includes(id));
if (fehlend.length > 0) {
  console.error(`✗ Chrome hat ${fehlend.length} Regelsatz/Regelsaetze NICHT geladen: ${fehlend.join(', ')}`);
  console.error('  Genau das passiert stillschweigend, wenn das Budget nicht reicht.');
  process.exit(1);
}

console.log(`✓ Alle ${sollAn.length} Regelsaetze geladen.`);
console.log(`  Luft nach oben: ${messung.frei.toLocaleString('de-DE')} Regeln — so viele koennte`);
console.log(`  das Paket zusaetzlich ab Werk aktivieren.`);
