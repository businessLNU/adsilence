/**
 * Warum zeigt eine Seite „Adblock erkannt"? Die Messung, bevor gebaut wird.
 *
 *     xvfb-run -a node tests/laufzeit/antiadblock-probe.mjs --seite=https://…
 *
 * Drei Läufe an derselben Adresse:
 *
 *   1. OHNE Erweiterung  — erscheint die Sperre auch dann? (Sonst misst man
 *      eine Seite, die jeden abweist, und sucht den Fehler bei sich.)
 *   2. MIT Erweiterung   — erscheint sie, und WELCHE Anfragen fehlen dabei?
 *      Geblockt heißt in Chrome `net::ERR_BLOCKED_BY_CLIENT`.
 *   3. MIT Erweiterung, aber die verdächtigen Anfragen ausdrücklich erlaubt
 *      (Sitzungsregeln, höchste Priorität). Verschwindet die Sperre, ist die
 *      Ursache benannt: Die Seite prüft, ob ihr Köder GELADEN wurde — dann
 *      hilft nur eine Attrappe (`$redirect`), kein Blocken.
 *
 * Die Probe ändert nichts am Paket und schreibt nichts in die Listen. Sie
 * beantwortet eine Frage, mehr nicht.
 */
import { existsSync, rmSync } from 'node:fs';

const { chromium } = await import(
  new URL('../../node_modules/playwright/index.mjs', import.meta.url).href
);
const ERW = new URL('../../dist/chromium', import.meta.url).pathname;

const argument = (name, standard = null) => {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : standard;
};
const SEITE = argument('seite');
const WARTEN = Number(argument('warten', '6000'));
if (!SEITE) {
  process.stderr.write('[antiadblock] --seite=<adresse> fehlt\n');
  process.exit(1);
}
if (!existsSync(`${ERW}/manifest.json`)) {
  process.stderr.write('[antiadblock] dist/chromium fehlt. → npm run build\n');
  process.exit(1);
}

/** Sätze, an denen eine Sperrkarte zu erkennen ist — bewusst mehrsprachig. */
const SPERRSATZ = /adblock|ad.?blocker|werbeblocker|disable your ad|deaktivieren sie ihren/i;

async function lauf({ mitErweiterung, erlaube = [] }) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 800 },
    locale: 'de-DE',
    ignoreDefaultArgs: mitErweiterung
      ? ['--disable-extensions', '--disable-component-extensions-with-background-pages']
      : [],
    args: [
      ...(mitErweiterung ? [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
    ],
  });

  const geblockt = [];
  try {
    if (mitErweiterung) {
      const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 30000 }));
      await new Promise((f) => setTimeout(f, 1500));
      if (erlaube.length) {
        await sw.evaluate(async (muster) => {
          await chrome.declarativeNetRequest.updateSessionRules({
            addRules: muster.map((m, i) => ({
              id: 8100 + i,
              priority: 1000,
              action: { type: 'allow' },
              condition: { urlFilter: m },
            })),
          });
        }, erlaube);
      }
    }

    const seite = await ctx.newPage();
    seite.on('requestfailed', (r) => {
      const grund = r.failure()?.errorText ?? '';
      if (grund.includes('BLOCKED')) geblockt.push({ url: r.url(), typ: r.resourceType(), grund });
    });

    await seite.goto(SEITE, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await seite.waitForTimeout(WARTEN);

    const befund = await seite.evaluate((quelle) => {
      const muster = new RegExp(quelle, 'i');
      const treffer = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 3) continue;
        const text = (el.textContent ?? '').trim();
        if (text.length > 0 && text.length < 300 && muster.test(text)) {
          const r = el.getBoundingClientRect();
          if (r.width > 40 && r.height > 20) treffer.push(text.replace(/\s+/g, ' ').slice(0, 120));
        }
      }
      // Welche Koedernamen kennt die Seite ueberhaupt?
      const koeder = ['adsbygoogle', 'google_ad_client', 'ima', 'prebid', 'aiptag', 'nitroAds', 'admiral']
        .filter((n) => n in window);
      return { sperre: [...new Set(treffer)].slice(0, 4), koederImFenster: koeder };
    }, SPERRSATZ.source);

    return { ...befund, geblockt };
  } finally {
    await ctx.close();
  }
}

const kurz = (u) => u.replace(/^https?:\/\//, '').slice(0, 96);

/**
 * Der zweite Weg, einen Blocker zu erkennen: ein Koeder-Element mit
 * werbetypischen Klassennamen anlegen und nachmessen, ob es verschwindet.
 * Das trifft KOSMETIK, nicht das Netz - und dagegen hilft keine Attrappe.
 */
async function koederTest(mitErweiterung) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: mitErweiterung
      ? ['--disable-extensions', '--disable-component-extensions-with-background-pages']
      : [],
    args: [
      ...(mitErweiterung ? [`--disable-extensions-except=${ERW}`, `--load-extension=${ERW}`] : []),
      '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    ],
  });
  try {
    if (mitErweiterung) {
      ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 30000 }));
      await new Promise((f) => setTimeout(f, 1500));
    }
    const seite = await ctx.newPage();
    await seite.goto(SEITE, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await seite.waitForTimeout(3000);
    // Manche Sperrseiten laden sich selbst neu (ihr Knopf heisst
    // „Aktualisieren", und ein Beobachter setzt ihn nach). Mitten in einer
    // Messung ist dann nicht nur die Seite weg, sondern der ganze Kontext -
    // ein zweiter Tab darin scheitert ebenfalls (gemessen am 09.09.2026 an
    // vidmoly.biz: `Target.createTarget: Failed to open a new tab`). Diese
    // Funktion wirft deshalb NIE; der Aufrufer startet notfalls einen
    // frischen Browser.
    return await messe(seite);
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Der Ködertest selbst, auf einer bereits geladenen Seite. */
function messe(seite) {
    return seite.evaluate(async () => {
      const namen = ['pub_300x250', 'text-ad', 'adsbox', 'ad-banner', 'banner_ad', 'sponsored'];
      const ergebnis = {};
      for (const n of namen) {
        const d = document.createElement('div');
        d.className = n;
        d.style.cssText = 'width:300px;height:250px;position:absolute;left:-9999px';
        document.body.appendChild(d);
        await new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)));
        const s = getComputedStyle(d);
        ergebnis[n] = d.offsetHeight === 0 || s.display === 'none' || s.visibility === 'hidden' ? 'versteckt' : 'sichtbar';
        d.remove();
      }
      return ergebnis;
    });
}

process.stdout.write(`Adresse: ${SEITE}\n\n`);

const ohne = await lauf({ mitErweiterung: false });
process.stdout.write(`1. OHNE Erweiterung — Sperre: ${ohne.sperre.length ? 'JA' : 'nein'}\n`);
for (const s of ohne.sperre) process.stdout.write(`     „${s}"\n`);
process.stdout.write(`   Köder im Fenster: ${ohne.koederImFenster.join(', ') || '—'}\n\n`);

const mit = await lauf({ mitErweiterung: true });
process.stdout.write(`2. MIT Erweiterung — Sperre: ${mit.sperre.length ? 'JA' : 'nein'}\n`);
for (const s of mit.sperre) process.stdout.write(`     „${s}"\n`);
process.stdout.write(`   Köder im Fenster: ${mit.koederImFenster.join(', ') || '—'}\n`);
process.stdout.write(`   geblockte Anfragen: ${mit.geblockt.length}\n`);
for (const g of mit.geblockt.slice(0, 15)) process.stdout.write(`     ${g.typ.padEnd(12)} ${kurz(g.url)}\n`);

// Nur Skripte sind Koeder-Kandidaten: Ein geblocktes Bild loest keine Pruefung
// aus, ein nicht geladenes Skript hinterlaesst eine undefinierte Variable.
const verdaechtig = [...new Set(mit.geblockt.filter((g) => g.typ === 'script').map((g) => new URL(g.url).hostname))];
if (verdaechtig.length && mit.sperre.length) {
  process.stdout.write(`\n3. MIT Erweiterung, aber diese Hosts erlaubt: ${verdaechtig.join(', ')}\n`);
  const frei = await lauf({ mitErweiterung: true, erlaube: verdaechtig.map((h) => `||${h}^`) });
  process.stdout.write(`   Sperre: ${frei.sperre.length ? 'JA — es liegt an etwas anderem' : 'NEIN — der Köder ist die Ursache'}\n`);
  for (const s of frei.sperre) process.stdout.write(`     „${s}"\n`);
} else if (!mit.sperre.length) {
  process.stdout.write('\n3. entfällt: mit Erweiterung erscheint keine Sperre.\n');
} else {
  process.stdout.write('\n3. entfällt: kein geblocktes SKRIPT — die Sperre hängt an etwas anderem.\n');
}

process.stdout.write('\n4. Der Ködertest: wird ein werbetypisches Element versteckt?\n');
let koederMit = await koederTest(true);
if (koederMit === null) koederMit = await koederTest(true); // ein zweiter Anlauf, neuer Browser
if (!koederMit) {
  process.stdout.write('   nicht messbar: die Seite lädt sich während der Messung neu.\n');
} else {
  for (const [name, wie] of Object.entries(koederMit)) {
    process.stdout.write(`   ${name.padEnd(14)} ${wie}\n`);
  }
  const verraeter = Object.entries(koederMit).filter(([, w]) => w === 'versteckt').map(([n]) => n);
  process.stdout.write(
    verraeter.length
      ? `   → An diesen Klassen ist der Blocker zu erkennen: ${verraeter.join(', ')}\n`
      : '   → Kein Köder verschwindet; die Erkennung läuft anders.\n',
  );
}

// Chrome legt beim Laden einer ENTPACKTEN Erweiterung `_metadata/` im Ordner
// an (vorkompilierte Regelindizes). Beim naechsten Laden weist es denselben
// Ordner dann zurueck - Namen mit `_` sind reserviert -, und die Erweiterung
// steht in `chrome://extensions` abgeschaltet da. Wer misst, raeumt das weg.
rmSync(new URL('../../dist/chromium/_metadata', import.meta.url).pathname, { recursive: true, force: true });
