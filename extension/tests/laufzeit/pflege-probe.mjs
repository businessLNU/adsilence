/**
 * Der Beweis fuer die taegliche Listenpflege.
 *
 *     node tests/laufzeit/pflege-probe.mjs
 *
 * Diese Probe braucht das laufende BACKEND: Die Erweiterung holt ihr Delta
 * von `GET /api/adsilence/listen/delta`, nicht mehr von den Listenquellen
 * selbst. Ohne Server faellt sie um, und das ist richtig so - was hier
 * geprueft wird, ist genau dieser Abruf.
 *
 * Vorher einmal `node scripts/listenpflege.mjs` im Wurzelverzeichnis fahren,
 * sonst liefert der Server ein leeres Delta.
 *
 * Die erste Probe ist die wichtigste: OHNE Premium darf nichts passieren,
 * auch keine Anfrage.
 */
const { chromium } = await import(new URL('../../node_modules/playwright/index.mjs', import.meta.url).href);
const ERW = new URL('../../dist/chromium', import.meta.url).pathname;
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const proben = [];
const pruefe = (name, erwartet, gemessen) => proben.push({ name, erwartet, gemessen, gut: String(erwartet) === String(gemessen) });
const browser = await chromium.launchPersistentContext('', {
  executablePath: CHROME, headless: false,
  ignoreDefaultArgs: ['--disable-extensions','--disable-component-extensions-with-background-pages'],
  args: [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`, '--no-first-run','--no-default-browser-check'],
});
try {
  const sw = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker', { timeout: 60000 }));
  await new Promise((f) => setTimeout(f, 2500));

  // OHNE Premium darf gar nichts passieren - auch keine Anfrage.
  const ohne = await sw.evaluate(async () => {
    const { einstellungen } = await chrome.storage.local.get('einstellungen');
    await chrome.storage.local.set({ einstellungen: { ...einstellungen, aktiv: true, listenPflege: true },
      lizenz: { tarif: 'frei', premium: false, planKeys: [], gueltigBis: null, endetZumTermin: false, hinweis: null, geprueftAm: Date.now() } });
    const vorher = (await chrome.declarativeNetRequest.getDynamicRules()).length;
    await new Promise((f) => setTimeout(f, 1500));
    return { vorher, nachher: (await chrome.declarativeNetRequest.getDynamicRules()).length };
  });
  pruefe('ohne Premium: keine dynamischen Regeln', ohne.vorher, ohne.nachher);

  // MIT Premium: der Lauf wird von Hand angestossen (der Alarm laeuft sonst
  // erst in fuenf Minuten) und muss Regeln nachtragen.
  const mit = await sw.evaluate(async () => {
    const { einstellungen } = await chrome.storage.local.get('einstellungen');
    await chrome.storage.local.set({ lizenz: { tarif: 'premium', premium: true, planKeys: ['premium'], gueltigBis: null, endetZumTermin: false, hinweis: null, geprueftAm: Date.now() } });
    await chrome.alarms.create('listenpflege', { when: Date.now() + 100 });
    // Auf den Stand warten, den die Pflege schreibt.
    for (let i = 0; i < 60; i++) {
      await new Promise((f) => setTimeout(f, 1000));
      const { listenPflegeStand } = await chrome.storage.local.get('listenPflegeStand');
      if (listenPflegeStand) {
        const regeln = await chrome.declarativeNetRequest.getDynamicRules();
        return { stand: listenPflegeStand, dyn: regeln.length, ids: regeln.map((r) => r.id) };
      }
    }
    return null;
  });
  if (!mit) {
    pruefe('mit Premium: Lauf beendet', true, false);
  } else {
    console.log('  Stand:', JSON.stringify(mit.stand).slice(0, 160));
    pruefe('Listen erreicht', true, mit.stand.gelesen.length > 0);
    pruefe('Regeln nachgetragen', true, mit.stand.neu > 0);
    pruefe('Budget eingehalten (hoechstens 1000)', true, mit.stand.neu <= 1000);
    const ausserhalb = mit.ids.filter((id) => id < 4000 || id >= 5000);
    pruefe('alle IDs im Bereich 4000..4999', 0, ausserhalb.length);
    pruefe('Firefox-Deckel nicht gerissen (hoechstens 5000)', true, mit.dyn <= 5000);
  }
} finally { await browser.close(); }
for (const p of proben) console.log(`${p.gut ? 'OK  ' : 'FEHL'} ${p.name}: erwartet ${p.erwartet}, gemessen ${p.gemessen}`);
const schlecht = proben.filter((p) => !p.gut).length;
console.log(`\n${proben.length - schlecht} von ${proben.length} Proben bestanden.`);
process.exitCode = schlecht ? 1 : 0;
