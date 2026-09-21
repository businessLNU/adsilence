#!/usr/bin/env node
/**
 * Der Vergleichslauf: AdSilence gegen andere Blocker, gemessen mit einem
 * FREMDEN Werkzeug.
 *
 *     npm run probe:vergleich
 *     npm run probe:vergleich -- --nur=adsilence,ublock-lite
 *
 * ── Warum ein fremdes Messwerkzeug ─────────────────────────────────────────
 * Ein selbst gebauter Vergleich hat immer denselben Einwand gegen sich: Die
 * Testfaelle koennten so gewaehlt sein, dass das eigene Produkt gewinnt. Der
 * Einwand ist berechtigt und laesst sich mit noch so sauberer Messung nicht
 * ausraeumen — nur dadurch, dass jemand anderes die Faelle bestimmt.
 *
 * `adblock-tester.com` tut das: 11 Dienste, 22 Pruefungen, seit 2023 dieselbe
 * Fassung. Wir waehlen daran nichts aus. Wer das Ergebnis anzweifelt, ruft die
 * Seite selbst auf und sieht dieselbe Zahl.
 *
 * ── Was die Seite NICHT ist ────────────────────────────────────────────────
 * Eine unabhaengige Testinstanz. Sie fuehrt eine „Top 5"-Tabelle, in der
 * ausschliesslich kostenpflichtige Angebote stehen, zwei davon VPN-Anbieter,
 * jedes mit Preis und Partnerlink; uBlock Origin fehlt darin, obwohl die
 * Startseite es selbst als Testbeispiel nennt. Was wir hier benutzen, ist
 * allein ihr MESSTEIL — die 22 Pruefungen und die Punktzahl. Die Tabelle
 * uebernehmen wir nicht, und ein Verweis auf sie waere Werbung fuer fremde
 * Abos.
 *
 * ── Was fuer eine Veroeffentlichung dazugehoert ────────────────────────────
 * Werbung mit Testergebnissen braucht eine nachpruefbare Fundstelle. Diese
 * Probe schreibt deshalb IMMER mit: Datum, Uhrzeit, Browserfassung und die
 * Version JEDER gemessenen Erweiterung. Eine Punktzahl ohne diese vier
 * Angaben ist in vier Wochen nicht mehr belegbar — die Listen aller
 * Beteiligten aendern sich taeglich.
 *
 * ── Die Grundlinie ─────────────────────────────────────────────────────────
 * Der erste Lauf ist IMMER derselbe Browser ohne jede Erweiterung. Ohne ihn
 * sagt „100 von 100" nichts: Erst der Abstand zu den 43 Punkten, die ein
 * blanker Chrome erreicht, zeigt, wieviel ueberhaupt zu blocken war.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');
const LAGER = join(WURZEL, '.vergleich');

/** Wo Playwright seinen Chrome hat — dieselbe Zeile wie in den uebrigen Proben. */
const CHROME =
  process.env.CHROME_PFAD ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/` +
    `Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const TESTSEITE = 'https://adblock-tester.com/';

/**
 * Die Vergleichsgruppe.
 *
 * Ausgewaehlt nach VERBREITUNG, nicht danach, gegen wen wir gut aussehen.
 *
 * Das ist die einzige Auswahlregel, die sich verteidigen laesst. Wer gezielt
 * Schwaechere dazunimmt, hat keinen Vergleich mehr, sondern eine Vorfuehrung —
 * und der Nachweis ist leicht zu fuehren: Man zaehlt, wer fehlt.
 *
 * Deshalb stehen hier AdBlock und Adblock Plus, die beiden groessten
 * ueberhaupt, obwohl niemand vorher wusste, wie sie abschneiden. Und deshalb
 * bleibt jedes Ergebnis stehen, auch wenn es gegen uns ausfaellt.
 *
 * Die Schwelle liegt bei den vier verbreitetsten. AdBlocker Ultimate lag
 * darunter und ist am 05.09.2026 herausgefallen — gemessen kam er auf
 * dieselben 77 wie AdGuard, AdBlock und Adblock Plus, seine Zeile sagte also
 * nichts, was die drei nicht schon sagen. Was NICHT der Grund war: dass er
 * schlecht abschneidet. Wer nach diesem Kriterium aussortiert, hat keinen
 * Vergleich mehr.
 *
 * NICHT dabei ist ausserdem Privacy Badger (EFF), obwohl er verbreitet ist. Er arbeitet
 * nicht mit Filterlisten, sondern lernt beim Surfen, welche Adressen einen
 * wiedererkennen — ein Test, der eine Seite einmal aufruft, kann das
 * konstruktionsbedingt nicht zeigen. Gemessen kam er auf 63 Punkte, in beiden
 * Spalten. Diese Zahl in dieselbe Tabelle zu setzen hiesse, zwei verschiedene
 * Verfahren mit demselben Massstab zu bewerten; eine Fussnote daneben
 * reparierte das nicht, sie entschuldigte es nur.
 *
 * Alle Uebrigen sind Erweiterungen aus dem Chrome Web Store und tun dasselbe wie wir;
 * ein VPN-Abo mit Blockfunktion waere kein Vergleich, sondern ein anderes
 * Produkt — das ist der Grund, warum die „Top 5" der Testseite hier nicht
 * abgebildet wird.
 *
 * `uBlock Origin` (die klassische Fassung) fehlt, und das ist keine Auswahl:
 * Sie ist mit dem Ende von MV2 aus dem Chrome Web Store verschwunden. Was
 * dort heute steht, ist `uBlock Origin Lite`.
 */
const ANDERE = [
  { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', schluessel: 'ublock-lite', name: 'uBlock Origin Lite' },
  { id: 'bgnkhhnnamicmpeenaelnjfhikgbkllg', schluessel: 'adguard', name: 'AdGuard' },
  { id: 'mlomiejdfkolichcflejclcbmpeaniij', schluessel: 'ghostery', name: 'Ghostery' },
  { id: 'gighmmpiobklfepjocnamgkkbiglidom', schluessel: 'adblock', name: 'AdBlock' },
  { id: 'cfhdojbkjhnklbpkdaibdccddilifddb', schluessel: 'adblock-plus', name: 'Adblock Plus' },
];

/** Die eigene, frisch gebaute Fassung. */
const EIGEN = { schluessel: 'adsilence', name: 'AdSilence', pfad: join(WURZEL, 'dist/chromium') };

// ── Beschaffung ────────────────────────────────────────────────────────────

/**
 * Eine Erweiterung aus dem Store holen und auspacken.
 *
 * Chrome laedt ueber `--load-extension` nur ENTPACKTE Ordner; eine `.crx` ist
 * ein ZIP mit einem Signaturkopf davor, der abgeschnitten werden muss. Die
 * Kopflaenge steht im Format selbst (CRX3: vier Bytes ab Position 8), sie
 * wird also gelesen und nicht geraten.
 */
function hole({ id, schluessel }) {
  const ordner = join(LAGER, schluessel);
  if (existsSync(join(ordner, 'manifest.json'))) return ordner;

  mkdirSync(LAGER, { recursive: true });
  const crx = join(LAGER, `${schluessel}.crx`);
  const url =
    'https://clients2.google.com/service/update2/crx?response=redirect' +
    `&prodversion=131&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
  execFileSync('curl', ['-sL', '-o', crx, url], { stdio: 'inherit' });

  const roh = readFileSync(crx);
  if (roh.subarray(0, 4).toString() !== 'Cr24') {
    throw new Error(`${schluessel}: keine CRX-Datei — der Store hat etwas anderes geliefert.`);
  }
  const fassung = roh.readUInt32LE(4);
  const start =
    fassung === 2 ? 16 + roh.readUInt32LE(8) + roh.readUInt32LE(12) : 12 + roh.readUInt32LE(8);
  const zip = join(LAGER, `${schluessel}.zip`);
  writeFileSync(zip, roh.subarray(start));
  mkdirSync(ordner, { recursive: true });
  execFileSync('unzip', ['-qo', zip, '-d', ordner]);
  return ordner;
}

/**
 * Der Fingerabdruck der gemessenen Datei.
 *
 * „AdGuard 5.5.2.17" ist eine Behauptung — eine Versionsnummer laesst sich
 * tippen. Der SHA-256 der `.crx` ist es nicht: Wer die Messung anzweifelt,
 * laedt dieselbe Erweiterung aus dem Store und vergleicht die Pruefsumme. Erst
 * damit steht fest, dass beide ueber DASSELBE reden.
 *
 * Fuer die eigene Erweiterung gibt es keine `.crx` — dort steht die Version
 * aus dem Manifest, und das Paket liegt ohnehin im Repo.
 */
function fingerabdruck(schluessel) {
  const crx = join(LAGER, `${schluessel}.crx`);
  if (!existsSync(crx)) return null;
  return `sha256:${createHash('sha256').update(readFileSync(crx)).digest('hex')}`;
}

/**
 * Version und Name aus dem Manifest.
 *
 * Der Name steht dort oft als `__MSG_extName__` — ein Verweis in die
 * Sprachdateien. Aufgeloest wird er ueber `_locales/en`; misslingt das, gilt
 * der Name aus unserer Liste. Fuer die Fundstellenangabe zaehlt ohnehin die
 * VERSION, und die steht immer im Klartext da.
 */
function angaben(ordner, rueckfall) {
  const m = JSON.parse(readFileSync(join(ordner, 'manifest.json'), 'utf8'));
  let name = m.name ?? rueckfall;
  const treffer = /^__MSG_(.+)__$/.exec(name ?? '');
  if (treffer) {
    for (const sprache of ['en', 'en_US', 'de']) {
      const pfad = join(ordner, '_locales', sprache, 'messages.json');
      if (!existsSync(pfad)) continue;
      const texte = JSON.parse(readFileSync(pfad, 'utf8'));
      if (texte[treffer[1]]?.message) {
        name = texte[treffer[1]].message;
        break;
      }
    }
  }
  return { name: treffer && /^__MSG_/.test(name) ? rueckfall : name, version: m.version };
}

// ── Messung ────────────────────────────────────────────────────────────────

/**
 * Ein Lauf: Browser auf, Testseite, Punktzahl ablesen, Browser zu.
 *
 * Jede Erweiterung bekommt ein FRISCHES Profil (`launchPersistentContext('')`
 * legt ein temporaeres an). Zwei Blocker gleichzeitig im selben Profil messen
 * hiesse, ihre Regelwerke zu mischen — die Testseite warnt davor selbst.
 *
 * Die 20 Sekunden Wartezeit sind kein Ratewert: Die Seite laedt ihre 22
 * Pruefungen nacheinander und rechnet erst danach. Mit 10 Sekunden stand die
 * Punktzahl bei zwei von drei Laeufen noch nicht fest.
 */
/**
 * Eine frisch geladene Erweiterung einsatzbereit machen.
 *
 * ── Warum das noetig ist ───────────────────────────────────────────────────
 * GEMESSEN am 05.09.2026: Ghostery kam auf 43 Punkte — auf den Punkt genau
 * derselbe Wert wie ein Browser ganz ohne Blocker. Der Grund stand in einem
 * Tab, den niemand angesehen hatte: „Willkommen bei Ghostery. Aktivieren Sie
 * Ghostery, um loszulegen." Bis dahin blockt es nichts; von 66 Anfragen
 * scheiterten zwei.
 *
 * Diese Zahl zu veroeffentlichen waere kein Vergleich gewesen, sondern eine
 * Falschaussage ueber ein fremdes Produkt — und zwar eine, die auffliegt,
 * sobald jemand sie nachstellt.
 *
 * ── Was hier passiert ──────────────────────────────────────────────────────
 * Wir suchen den Begruessungstab und druecken, was dort nach „einschalten"
 * aussieht — als Knopf, als Verweis oder als angeklickte Beschriftung. Die
 * Woerter stehen in mehreren Sprachen da, weil der Browser die Systemsprache
 * nimmt.
 *
 * Das ist eine ZUSTIMMUNG, die wir im Namen eines Testprofils erteilen. Sie
 * gilt einem Wegwerf-Browser ohne Daten und ist der einzige Weg, das Produkt
 * so zu messen, wie ein Kunde es benutzt.
 */
async function bereitmachen(browser) {
  await new Promise((f) => setTimeout(f, 4000));

  /*
   * Gesucht wird DURCH Shadow DOM hindurch. Ghosterys Begruessung besteht aus
   * Web Components (`ui-action`, `ui-mode-radio`, `ui-button`), und deren
   * Inneres liegt in Shadow Roots — eine Suche im normalen Dokument findet
   * dort gar nichts. Genau daran ist der erste Anlauf gescheitert: Er meldete
   * „kein Knopf gefunden" auf einer Seite voller Knoepfe.
   */
  const KLICKBAR = `(() => {
    const raus = [];
    const lauf = (wurzel, tiefe) => {
      if (tiefe > 8) return;
      for (const el of wurzel.querySelectorAll('*')) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') {
          raus.push(el);
        }
        if (el.shadowRoot) lauf(el.shadowRoot, tiefe + 1);
      }
    };
    lauf(document, 0);
    return raus;
  })()`;

  /*
   * Zwei Arten von Schritten, in dieser Reihenfolge:
   *
   *   1. Eine AUSWAHL („Filtermodus auswaehlen"). Genommen wird die erste
   *      Option — das ist ueberall die vom Anbieter empfohlene, und genau die
   *      bekommt ein Kunde, der nicht nachdenkt. Etwas anderes zu waehlen
   *      hiesse, das Produkt anders zu messen, als es ausgeliefert wird.
   *   2. Ein WEITER/ZUSTIMMEN-Knopf.
   *
   * Bis zu vier Runden, weil die Begruessung mehrseitig ist. Nach jeder Runde
   * wird geprueft, ob schon geblockt wird; sobald ja, ist Schluss.
   */
  const WOERTER =
    /aktivieren|enable|activate|einschalten|zustimmen|agree|accept|akzeptieren|los ?geht|get started|weiter|continue|fertig|done/i;

  for (let runde = 0; runde < 4; runde += 1) {
    let geklickt = false;
    for (const seite of browser.pages()) {
      if (!seite.url().startsWith('chrome-extension://')) continue;
      geklickt =
        (await seite
          .evaluate(
            ([ausdruck, muster]) => {
              const elemente = eval(ausdruck);
              const passt = new RegExp(muster.slice(1, muster.lastIndexOf('/')), 'i');
              // Erst ein benannter Knopf …
              const benannt = elemente.find((e) =>
                passt.test((e.innerText || e.textContent || '').trim()),
              );
              if (benannt) {
                benannt.click();
                return true;
              }
              // … sonst die erste Option einer Auswahl.
              const option = elemente.find((e) => e.closest('ui-action, ui-mode-radio, [role="radio"]'));
              if (option) {
                option.click();
                return true;
              }
              return false;
            },
            [KLICKBAR, String(WOERTER)],
          )
          .catch(() => false)) || geklickt;
      await seite.waitForTimeout(1500).catch(() => {});
    }
    if (!geklickt) break;
  }
}

/**
 * Blockt die Erweiterung ueberhaupt schon?
 *
 * Eine Aufwaermrunde auf derselben Seite, bei der nur gezaehlt wird, wieviele
 * Anfragen scheitern. Ein Blocker, der auf dieser Seite NICHTS abbricht, ist
 * nicht einsatzbereit — dann sind seine Listen noch nicht geladen, oder er
 * wartet auf eine Zustimmung, die wir nicht gefunden haben.
 *
 * Der Schwellwert ist bewusst niedrig (fuenf): Er trennt „laeuft ueberhaupt"
 * von „laeuft nicht", nicht gut von schlecht. Wer hier misst, wie GUT jemand
 * blockt, hat sich sein eigenes Messwerkzeug gebaut — und genau das wollten
 * wir nicht.
 */
async function laeuftSchon(browser) {
  const seite = await browser.newPage();
  let abgebrochen = 0;
  seite.on('requestfailed', () => {
    abgebrochen += 1;
  });
  try {
    await seite.goto(TESTSEITE, { waitUntil: 'load', timeout: 60000 });
    await seite.waitForTimeout(12000);
  } catch {
    /* Eine gescheiterte Aufwaermrunde ist kein Grund abzubrechen. */
  } finally {
    await seite.close().catch(() => {});
  }
  return abgebrochen;
}

/**
 * Wo ein von Hand vorbereitetes Profil liegt.
 *
 * Manche Erweiterungen lassen sich nicht automatisch einschalten: Ghostery
 * verlangt eine Zustimmung, die als eigenes Fenster mit eigenem Aufbau kommt
 * und sich der Suche nach „Aktivieren" entzieht. Statt den Klickweg jeder
 * fremden Oberflaeche nachzubauen — und ihn beim naechsten Update wieder zu
 * verlieren — gibt es dafuer EINEN Handgriff:
 *
 *     npm run probe:vergleich -- --vorbereiten=ghostery
 *
 * Das oeffnet den Browser mit dieser Erweiterung und einem DAUERHAFTEN Profil
 * und laesst ihn offen. Wer davor sitzt, klickt das Willkommensfenster durch
 * und schliesst das Fenster. Ab dann findet jede Messung das fertige Profil
 * und benutzt es.
 *
 * Im Bericht steht, welche Erweiterung so vorbereitet wurde — wer die Zahlen
 * spaeter liest, soll wissen, dass hier ein Mensch geklickt hat.
 */
function profilPfad(schluessel) {
  return join(LAGER, 'profile', schluessel);
}

/** Wohin die Belege dieses Laufs kommen: ein Ordner je Messung. */
const BELEGE = join(WURZEL, 'vergleich', new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));

/**
 * Alle Regelsätze einschalten, die das Manifest mitbringt.
 *
 * ── Warum das gemessen wird ────────────────────────────────────────────────
 * Die Werkseinstellung sagt, was jemand OHNE Zutun bekommt. Sie sagt nicht,
 * was ein Produkt kann — und wer nur sie zeigt, laesst offen, ob die anderen
 * technisch nicht koennen oder nur nicht wollen. GEMESSEN am 05.09.2026: uBlock
 * Origin Lite kommt ab Werk auf 91 und voll ausgestattet auf 100. Es kann also
 * dasselbe; es liefert nur weniger eingeschaltet aus. Diese Spalte
 * wegzulassen hiesse, eine Frage offen zu lassen, die jeder selbst
 * beantworten kann.
 *
 * ── Was dabei NICHT gemessen wird ──────────────────────────────────────────
 * Manifest V3 laesst hoechstens 50 statische Regelsaetze gleichzeitig zu.
 * AdGuard bringt 53 mit, uBlock Lite 56 — bei beiden bleiben ein paar aus,
 * und die Fehlermeldung steht im Bericht. „Mit allen Listen" heisst deshalb
 * genauer: mit so vielen, wie die Plattform zulaesst.
 *
 * Eingeschaltet wird ueber die Schnittstelle, nicht ueber die Oberflaeche der
 * jeweiligen Erweiterung. Bei Produkten, die ihre Listen selbst verwalten,
 * kann deren eigene Logik anders arbeiten als ein Klick in ihren
 * Einstellungen; auch das steht im Bericht.
 */
async function alleListen(browser) {
  const sw =
    browser.serviceWorkers()[0] ??
    (await browser.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null));
  if (!sw) return { gesamt: 0, an: 0, abgelehnt: [] };
  return sw
    .evaluate(async () => {
      const m = chrome.runtime.getManifest();
      const alle = (m.declarative_net_request?.rule_resources ?? []).map((r) => r.id);
      const vorher = await chrome.declarativeNetRequest.getEnabledRulesets();
      const abgelehnt = [];
      // Einzeln: Ein Limit soll nicht alle uebrigen mitreissen.
      for (const id of alle.filter((x) => !vorher.includes(x))) {
        try {
          await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [id] });
        } catch (e) {
          abgelehnt.push(id);
        }
      }
      const nachher = await chrome.declarativeNetRequest.getEnabledRulesets();
      return { gesamt: alle.length, an: nachher.length, abgelehnt };
    })
    .catch(() => ({ gesamt: 0, an: 0, abgelehnt: [] }));
}

async function miss(pfad, profil, beleg, mitAllen = false) {
  const args = ['--no-first-run', '--no-default-browser-check'];
  const opts = { executablePath: CHROME, headless: false, args };
  if (pfad) {
    opts.ignoreDefaultArgs = [
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
    ];
    args.unshift(`--disable-extensions-except=${pfad}`, `--load-extension=${pfad}`);
  }

  /*
   * Ohne vorbereitetes Profil ein leerer Pfad: Playwright legt dann ein
   * Wegwerfprofil an. Mit Profil wird es wiederverwendet — samt der
   * Zustimmung, die jemand dort einmal erteilt hat.
   */
  const browser = await chromium.launchPersistentContext(profil ?? '', opts);
  try {
    let bereit = true;
    let listen = null;
    if (pfad) {
      // Auf den Service Worker warten: Vorher stehen die Regeln nicht.
      browser.serviceWorkers()[0] ??
        (await browser.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null));
      await bereitmachen(browser);
      /*
       * Zwei Anlaeufe: Der erste waermt auf (Listen laden, Zustimmung wirken
       * lassen), der zweite prueft, ob es geholfen hat. AdGuard laedt seine
       * Listen beim ersten Start aus dem Netz — nach drei Sekunden gemessen
       * waere das eine Aussage ueber seine Startzeit, nicht ueber sein
       * Blockvermoegen.
       */
      let treffer = await laeuftSchon(browser);
      if (treffer < 5) {
        await new Promise((f) => setTimeout(f, 8000));
        treffer = await laeuftSchon(browser);
      }
      bereit = treffer >= 5;
      if (mitAllen) {
        listen = await alleListen(browser);
        await new Promise((f) => setTimeout(f, 4000));
      }
    }
    const seite = await browser.newPage();
    await seite.goto(TESTSEITE, { waitUntil: 'load', timeout: 60000 });
    await seite.waitForTimeout(20000);
    /*
     * Abgelesen wird `.final-score-value` und NICHT die groesste Zahl im Text.
     * Der erste Anlauf tat das und fand die „90" aus dem Werbesatz
     * „RECOMMENDED IF YOUR SCORE IS UNDER 90/100" — mit und ohne Blocker
     * dieselbe Zahl, was gestimmt haette, wenn es eine Messung gewesen waere.
     */
    const punkte = await seite.evaluate(() => {
      const feld = document.querySelector('.final-score-value');
      return feld ? Number.parseInt(feld.textContent.trim(), 10) : null;
    });
    if (punkte === null) throw new Error('Punktzahl nicht gefunden — hat die Testseite sich geändert?');
    /*
     * Das Bild ist kein Beweis, sondern eine Illustration: Wer faelschen will,
     * faelscht ein PNG in zwei Minuten. Es steht trotzdem hier, weil es die
     * Behauptung ANSCHAULICH macht — und weil es auffaellt, wenn Bild und Zahl
     * im Bericht auseinandergehen.
     */
    if (beleg) {
      mkdirSync(BELEGE, { recursive: true });
      await seite.screenshot({ path: join(BELEGE, `${beleg}.png`), fullPage: true });
    }
    return { punkte, bereit, listen };
  } finally {
    await browser.close();
  }
}

// ── Lauf ───────────────────────────────────────────────────────────────────

/**
 * Wie oft jede Erweiterung gemessen wird.
 *
 * GEMESSEN am 05.09.2026: Derselbe Browser ohne jede Erweiterung kam in zwei
 * Laeufen auf 43 und auf 48 Punkte. Die Testseite ruft echte Werbedienste auf,
 * und die antworten nicht jedes Mal gleich — fuenf Punkte Rauschen bei
 * unveraenderter Konfiguration.
 *
 * Fuer einen Blick zwischendurch ist das gleichgueltig. Fuer eine Zahl auf
 * einer Website ist es das nicht: Dieselbe Schwankung trifft jede Zeile, und
 * wer mit einem einzelnen Lauf wirbt, wirbt mit einem Wuerfelwurf.
 *
 * Ausgewiesen wird deshalb der MEDIAN und die Spannweite. Der Median und
 * nicht der Mittelwert: Ein einzelner Ausreisser nach unten (eine Anzeige,
 * die gerade nicht geladen hat) zieht den Mittelwert mit, den Median nicht.
 * Und nicht der Bestwert — mit dem besten von fuenf Laeufen zu werben ist
 * genau die Auswahl, die dem ganzen Vergleich seine Glaubwuerdigkeit nimmt.
 */
const LAEUFE = Number.parseInt(
  process.argv.find((a) => a.startsWith('--laeufe='))?.slice(9) ?? '3',
  10,
);

/** Median einer Zahlenreihe — bei gerader Anzahl der kleinere der beiden mittleren. */
function median(zahlen) {
  const sortiert = [...zahlen].sort((a, b) => a - b);
  return sortiert[Math.floor((sortiert.length - 1) / 2)];
}

/**
 * Mehrere Laeufe einer Erweiterung, jeder mit frischem Browser.
 *
 * Frisch und nicht dieselbe Sitzung noch einmal: Beim zweiten Aufruf derselben
 * Seite liegt die halbe Werbung im Zwischenspeicher, und was aus dem Cache
 * kommt, wird gar nicht erst angefragt. Der zweite Lauf im selben Browser
 * saehe deshalb besser aus, ohne dass jemand besser blockt.
 */
async function messreihe(pfad, profil, laeufe, schluessel) {
  const werte = [];
  let bereit = true;
  for (let i = 0; i < laeufe; i += 1) {
    const ergebnis = await miss(pfad, profil, `${schluessel}-lauf${i + 1}`);
    werte.push(ergebnis.punkte);
    bereit = bereit && ergebnis.bereit;
  }
  /*
   * Die zweite Spalte wird GENAUSO OFT gemessen wie die erste.
   *
   * Der erste Anlauf nahm dafuer einen einzigen Lauf, mit der Begruendung, die
   * Streuung sei schon aus Spalte eins bekannt — sie komme von der Testseite
   * und nicht von der Erweiterung. Das stimmte nicht. GEMESSEN am 05.09.2026
   * in zwei Durchgaengen: AdGuard voll ausgestattet einmal 81, einmal 91;
   * Ghostery einmal 97, einmal 100. Zehn Punkte Unterschied, waehrend Spalte
   * eins ueber drei Laeufe auf denselben Wert kam.
   *
   * Der Grund liegt im Einschalten selbst: Wieviele der Regelsaetze zum
   * Zeitpunkt der Messung wirklich greifen, haengt am Timing — die
   * Erweiterungen laden dabei nach. Eine Spalte, die um zehn Punkte springt,
   * gehoert nicht auf eine Website, und schon gar nicht ueber ein fremdes
   * Produkt.
   *
   * Die Grundlinie bekommt weiterhin keine zweite Spalte: Ohne Erweiterung
   * gibt es nichts einzuschalten.
   */
  let voll = null;
  if (pfad) {
    const vollwerte = [];
    let listen = null;
    for (let i = 0; i < laeufe; i += 1) {
      const ergebnis = await miss(pfad, profil, `${schluessel}-voll${i + 1}`, true);
      vollwerte.push(ergebnis.punkte);
      listen = ergebnis.listen ?? listen;
    }
    voll = {
      punkte: median(vollwerte),
      von: Math.min(...vollwerte),
      bis: Math.max(...vollwerte),
      werte: vollwerte,
      listen,
    };
  }
  return {
    punkte: median(werte),
    von: Math.min(...werte),
    bis: Math.max(...werte),
    werte,
    bereit,
    voll,
  };
}

const vorbereiten = process.argv.find((a) => a.startsWith('--vorbereiten='))?.slice(14);
const nur = process.argv.find((a) => a.startsWith('--nur='))?.slice(6)?.split(',');

if (vorbereiten) {
  const eintrag = [EIGEN, ...ANDERE].find((e) => e.schluessel === vorbereiten);
  if (!eintrag) {
    console.error(`Unbekannt: ${vorbereiten}. Bekannt sind: ${[EIGEN, ...ANDERE].map((e) => e.schluessel).join(', ')}`);
    process.exit(1);
  }
  const ordner = eintrag.pfad ?? hole(eintrag);
  const profil = profilPfad(eintrag.schluessel);
  mkdirSync(profil, { recursive: true });
  console.log(`\n  ${eintrag.name} wird geöffnet.`);
  console.log('  Klick das Willkommensfenster durch, bis die Erweiterung aktiv ist.');
  console.log('  Danach dieses Fenster schließen — das Profil bleibt erhalten.\n');
  const browser = await chromium.launchPersistentContext(profil, {
    executablePath: CHROME,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: [
      `--disable-extensions-except=${ordner}`,
      `--load-extension=${ordner}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  // Warten, bis der Mensch fertig ist — erkennbar daran, dass er das Fenster
  // schliesst. Ein Zeitgeber waere geraten; das hier ist gemessen.
  await new Promise((fertig) => browser.on('close', fertig));
  console.log(`  Profil gespeichert: ${profil}`);
  console.log('  Jetzt `npm run probe:vergleich` — die Messung benutzt es.\n');
  process.exit(0);
}
const browserfassung = (() => {
  try {
    return execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unbekannt';
  }
})();

if (!existsSync(join(EIGEN.pfad, 'manifest.json'))) {
  console.error('dist/chromium fehlt. Erst `npm run build`, dann diese Probe.');
  process.exit(1);
}

const zeilen = [];

/** „100 / 100" bei stabiler Reihe, sonst „ 91 / 100  (88–93)". */
function zeige({ punkte, von, bis }) {
  const kern = `${String(punkte).padStart(3)} / 100`;
  return von === bis ? kern : `${kern}  (${von}–${bis})`;
}

console.log(`\n  AdBlock-Tester-Vergleich · ${new Date().toLocaleString('de-DE')}`);
console.log(`  ${browserfassung}`);
console.log(`  Messung: ${TESTSEITE} (11 Dienste, 22 Prüfungen), ${LAEUFE} Läufe je Eintrag`);
console.log('  Angegeben ist der Median; in Klammern die Spannweite.\n');

// Die Grundlinie zuerst.
if (!nur) {
  const reihe = await messreihe(null, null, LAEUFE, 'ohne-erweiterung');
  zeilen.push({ name: 'ohne Erweiterung', version: '—', ...reihe });
  console.log(`  ${'ohne Erweiterung'.padEnd(30)} ${zeige(reihe)}`);
}

for (const eintrag of [EIGEN, ...ANDERE]) {
  if (nur && !nur.includes(eintrag.schluessel)) continue;
  let ordner;
  try {
    ordner = eintrag.pfad ?? hole(eintrag);
  } catch (e) {
    console.log(`  ${eintrag.name.padEnd(22)} übersprungen: ${e.message}`);
    continue;
  }
  const { name, version } = angaben(ordner, eintrag.name);
  try {
    const profil = existsSync(profilPfad(eintrag.schluessel)) ? profilPfad(eintrag.schluessel) : null;
    const reihe = await messreihe(ordner, profil, LAEUFE, eintrag.schluessel);
    const { punkte, bereit } = reihe;
    zeilen.push({
      name,
      /*
       * Der KURZE Name fuer die Website, der volle fuer den Beleg.
       *
       * Im Manifest steht, was der Store zeigt: „Ghostery AdBlocker for
       * Privacy". In einer Balkenreihe bricht das auf zwei Zeilen um und
       * schiebt seinen eigenen Balken nach unten — und gemeint ist ohnehin die
       * Marke. Im Bericht bleibt der volle Name stehen: Dort geht es darum,
       * genau zu benennen, was gemessen wurde.
       */
      kurzname: eintrag.name,
      version,
      ...reihe,
      profilVorbereitet: Boolean(profil),
      datei: fingerabdruck(eintrag.schluessel),
    });
    /*
     * Ein unfertiger Blocker bekommt KEINE Punktzahl in der Tabelle, sondern
     * einen Hinweis. Eine Zahl mit Sternchen wandert erfahrungsgemaess ohne
     * das Sternchen weiter.
     */
    console.log(
      bereit
        ? `  ${name.padEnd(30)} ${zeige(reihe)}${reihe.voll ? `   voll: ${zeige(reihe.voll).replace(' / 100', '')}` : ''}   v${version}`
        : `  ${name.padEnd(30)}   — nicht einsatzbereit (blockt nichts; Zustimmung offen?)   v${version}`,
    );
  } catch (e) {
    console.log(`  ${name.padEnd(30)} FEHLER: ${e.message}`);
  }
}

/*
 * Das Ergebnis als Datei, nicht nur auf dem Bildschirm: Wer damit wirbt,
 * braucht es in vier Wochen noch — und dann ist die Ausgabe im Terminal weg.
 */
const bericht = {
  gemessenAm: new Date().toISOString(),
  messwerkzeug: TESTSEITE,
  umfang: '11 Dienste, 22 Prüfungen',
  laeufeJeEintrag: LAEUFE,
  hinweis:
    'Gemessen wird die WERKSEINSTELLUNG jeder Erweiterung — was ein Kunde nach ' +
    'der Installation bekommt, ohne eine Liste dazuzuschalten. AdGuard etwa bringt ' +
    '53 Regelsätze mit und liefert einen davon eingeschaltet aus.',
  browser: browserfassung,
  /*
   * Wer die Zahlen spaeter liest, soll wissen, wo ein Mensch eingegriffen
   * hat: „profilVorbereitet" heisst, dass jemand die Zustimmung dieser
   * Erweiterung von Hand erteilt hat, weil sie sonst gar nicht blockt.
   */
  ergebnisse: zeilen,
};
mkdirSync(BELEGE, { recursive: true });
writeFileSync(join(BELEGE, 'bericht.json'), `${JSON.stringify(bericht, null, 2)}\n`, 'utf8');

/*
 * Dieselben Zahlen als Tabelle zum Einsetzen — mit Fussnote.
 *
 * Ohne den Zusatz „in Werkseinstellung" waere die Tabelle angreifbar: AdGuard
 * bringt 53 Regelsaetze mit und liefert einen davon eingeschaltet aus. Wer ihn
 * einrichtet, bekommt andere Zahlen. Gemessen wurde, was ein Kunde nach der
 * Installation vorfindet — das ist eine Aussage, und sie muss dabeistehen.
 */
const tabelle = [
  `# Blockvergleich, ${new Date().toLocaleDateString('de-DE')}`,
  '',
  `Messwerkzeug: ${TESTSEITE} (11 Dienste, 22 Prüfungen, fremd betrieben).`,
  `Browser: ${browserfassung}. ${LAEUFE} Läufe je Eintrag, angegeben ist der Median.`,
  '',
  '| Erweiterung | Punkte | Version |',
  '|---|---|---|',
  ...zeilen.map(
    (z) =>
      `| ${z.name} | ${z.bereit ? `${z.punkte} / 100${z.von === z.bis ? '' : ` (${z.von}–${z.bis})`}` : 'nicht einsatzbereit'} | ${z.version} |`,
  ),
  '',
  'Gemessen in **Werkseinstellung** — was nach der Installation aktiv ist, ohne',
  'eine Liste dazuzuschalten. Wer eine Erweiterung einrichtet, kann andere Werte',
  'erreichen.',
  '',
  'Nachstellen: `npm run probe:vergleich` in diesem Verzeichnis. Prüfsummen der',
  'gemessenen Pakete und alle Einzelwerte stehen in `bericht.json` daneben.',
  '',
].join('\n');
writeFileSync(join(BELEGE, 'tabelle.md'), tabelle, 'utf8');

/*
 * Dieselben Zahlen fuer die Website — als Datei, die beim Bauen mitgeht.
 *
 * ── Warum nicht in `Start.tsx` getippt ─────────────────────────────────────
 * Eine Zahl im Quelltext ist eine Zahl, die niemand nachzieht (Regel 6.4). Hier
 * kaeme dazu, dass sie fremde Produkte betrifft: Ein veralteter Wert waere
 * keine Nachlaessigkeit, sondern eine Falschaussage ueber einen Mitbewerber.
 *
 * Also schreibt sie DIE MESSUNG. Wer die Tabelle auf der Seite aendern will,
 * misst neu — es gibt keinen anderen Weg, und das ist der Punkt.
 *
 * ── Warum ohne Pruefsummen ─────────────────────────────────────────────────
 * Die Datei liegt im Browser jedes Besuchers. Was er sehen soll, ist das
 * Ergebnis; die Pruefsummen und Einzelwerte stehen im Beleg-Ordner, der
 * NICHT ausgeliefert wird. Wer sie braucht, bekommt sie auf Nachfrage — mit
 * dem Skript daneben, das sie erzeugt hat.
 */
const fuerSeite = {
  gemessenAm: bericht.gemessenAm.slice(0, 10),
  messwerkzeug: TESTSEITE,
  browser: browserfassung,
  laeufe: LAEUFE,
  hoechstwert: 100,
  ergebnisse: zeilen
    .filter((z) => z.bereit)
    .map((z) => ({
      name: z.kurzname ?? z.name,
      punkte: z.punkte,
      /* `null` bei der Grundlinie — dort gibt es nichts einzuschalten. */
      punkteVoll: z.voll?.punkte ?? null,
      punkteVollVon: z.voll?.von ?? null,
      punkteVollBis: z.voll?.bis ?? null,
      listenGesamt: z.voll?.listen?.gesamt ?? null,
      listenAn: z.voll?.listen?.an ?? null,
      version: z.version,
      eigen: z.name === EIGEN.name,
    }))
    .sort((a, b) => b.punkte - a.punkte),
};
const seitenZiel = resolve(WURZEL, '../demo/src/daten/vergleich.json');
mkdirSync(dirname(seitenZiel), { recursive: true });
writeFileSync(seitenZiel, `${JSON.stringify(fuerSeite, null, 2)}\n`, 'utf8');

console.log(`\n  Für die Website: ${seitenZiel}`);
console.log(`\n  Belege: ${BELEGE}`);
console.log('    bericht.json   alle Einzelwerte, Versionen, Prüfsummen');
console.log('    tabelle.md     dieselben Zahlen als Tabelle, mit Fußnote');
console.log(`    *.png          je ein Bild pro Lauf (${LAEUFE} je Eintrag)\n`);
