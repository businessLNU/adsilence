/**
 * Alle Nachrichten aus vertrag.md Abschnitt 7, dazu `kosmetik` vom
 * Inhaltsskript. Antwortform `{ ok: true, ...daten } | { ok: false, code }`.
 *
 * Wer darf was: Zustandsaenderungen nur aus der eigenen Oberflaeche (Popup,
 * Optionsseite), erkennbar an der Herkunft `sender.url` unter der eigenen
 * Erweiterungsadresse. Das Inhaltsskript darf genau eine Frage stellen:
 * welche Selektoren fuer seinen Host gelten.
 */

import { api } from '../gemeinsam/browser.ts';
import { BROWSER, MELDUNG_MAX_REGELN, MELDUNG_MAX_REGEL_LAENGE, VERSION, bereicheVon } from '../gemeinsam/konstanten.ts';
import { liesLokal, liesSitzung, schreibeLokal } from '../gemeinsam/speicher.ts';
import type { MeldungVorschau, Nachricht, Sites, TabZustand, Zustand } from '../gemeinsam/typen.ts';
import { abgleichJetzt } from './abgleich.ts';
import { allesAnwenden } from './anwenden.ts';
import { hostAus, siteErlaubt } from './ausnahmen.ts';
import { trefferImTab, vomBadge } from './badge.ts';
import { pflegeListen } from './listenpflege.ts';
import { cookieAntwort, warnungFuer } from './verwechslung.ts';
import { ApiFehler, checkoutUrl, kontoTrennen, meldungSenden, tarifeHolen, verbindungStarten } from './konto.ts';
import { generischesCss, kosmetikFuer } from './kosmetik.ts';
import { lizenzFrisch, lizenzWirksam } from './lizenz-regeln.ts';
import { aktuelleLizenz, lizenzPruefen } from './lizenz.ts';
import { pruefeNachricht, seiteOhneQuery } from './pruefung.ts';
import { aktiveListen, aktualisiereDynamischeRegeln, listenInfo } from './regeln.ts';
import { scriptletsFuer } from './scriptlets.ts';

type Sender = chrome.runtime.MessageSender;

function ausEigenerOberflaeche(sender: Sender): boolean {
  if (sender.id && sender.id !== api.runtime.id) return false;
  const url = sender.url ?? '';
  return url.startsWith(api.runtime.getURL(''));
}

async function tabZustand(tabId: number | undefined, sites: Sites): Promise<TabZustand | null> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = tabId !== undefined ? await api.tabs.get(tabId) : (await api.tabs.query({ active: true, currentWindow: true }))[0];
  } catch {
    tab = undefined;
  }
  const host = hostAus(tab?.url);
  if (!tab || !host) return null;
  if (tab.id === undefined) {
    return { host, erlaubt: siteErlaubt(sites, host), blockiert: null, jeListe: [] };
  }
  const treffer = await trefferImTab(tab.id);
  return {
    host,
    erlaubt: siteErlaubt(sites, host),
    blockiert: treffer ? treffer.gesamt : await vomBadge(tab.id),
    jeListe: treffer?.jeListe ?? [],
  };
}

async function zustand(tabId: number | undefined): Promise<Zustand> {
  const [lokal, sitzung, listen] = await Promise.all([
    liesLokal('einstellungen', 'sites', 'konto', 'kontoHinweis', 'lizenz', 'verbindungOffen'),
    liesSitzung('listenFehler', 'verbindungFehler'),
    listenInfo(),
  ]);
  const jetzt = Date.now();

  // Popup geoeffnet und der Stand ist aelter als eine Stunde: nachfragen,
  // aber nicht darauf warten. Das Popup zeigt den letzten Stand sofort und
  // zieht ueber `storage.onChanged` nach.
  if (lokal.konto && !lizenzFrisch(lokal.lizenz, jetzt)) void lizenzPruefen('popup');

  const offen = lokal.verbindungOffen && lokal.verbindungOffen.laeuftAb > jetzt ? lokal.verbindungOffen : null;

  return {
    tab: await tabZustand(tabId, lokal.sites),
    aktiv: lokal.einstellungen.aktiv,
    listen: listen.map((l) => ({
      sprache: l.sprache,
      id: l.id,
      name: l.name,
      aktiv: lokal.einstellungen.listen[l.id] ?? l.standard,
      regeln: l.regeln,
      premium: l.premium,
      standard: l.standard,
    })),
    konto: {
      verbunden: lokal.konto !== null,
      email: lokal.konto?.email,
      name: lokal.konto?.name ?? undefined,
      hinweis: lokal.kontoHinweis,
    },
    lizenz: lizenzWirksam(lokal.lizenz, jetzt),
    verbindung: offen ? { code: offen.code, verbindenUrl: offen.verbindenUrl, laeuftAb: offen.laeuftAb } : null,
    version: VERSION,
    browser: BROWSER,
    einstellungen: lokal.einstellungen,
    listenFehler: sitzung.listenFehler,
    verbindungFehler: sitzung.verbindungFehler,
  };
}

async function meldungVorschau(tabId: number): Promise<MeldungVorschau> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await api.tabs.get(tabId);
  } catch {
    tab = undefined;
  }
  const seite = tab?.url ? seiteOhneQuery(tab.url) : null;
  if (!seite) throw new ApiFehler('KEINE_SEITE', '', 0);
  const host = hostAus(tab?.url)!;

  const [listen, kosmetik, scriptlets] = await Promise.all([aktiveListen(), kosmetikFuer(host), scriptletsFuer(host)]);
  const regeln = [
    ...kosmetik.selektoren.map((s) => `##${s}`),
    ...scriptlets.map((e) => `##+js(${[e.name, ...e.args].join(', ')})`),
  ]
    .slice(0, MELDUNG_MAX_REGELN)
    .map((r) => r.slice(0, MELDUNG_MAX_REGEL_LAENGE));

  /*
   * `bereicheVon` und nicht `listen`: Unter „Aktive Listen" standen die rohen
   * Kennungen — `ublock`, `urlhaus`, `antiadblock`. Das sind Namen fremder
   * Projekte in einem Fenster, das unser Produkt zeigt, und fuer den Kunden
   * ist es eine Zutatenliste ohne Bedeutung. Der Bereich sagt demjenigen, der
   * die Meldung bearbeitet, dasselbe und nennt niemanden.
   */
  return { seite, browser: BROWSER, version: VERSION, listen: bereicheVon(listen), regeln };
}

async function behandle(n: Nachricht, sender: Sender): Promise<Record<string, unknown>> {
  // Die OBERSTE Seite kommt vom Absender, nicht aus der Nachricht: Ein
  // Rahmen kann ueber seinen eigenen Host nicht luegen, wohl aber ueber jeden
  // anderen. `sender.tab.url` liefert der Browser selbst (host_permissions
  // <all_urls>); fehlt sie (kein Tab, fremdes Schema), gilt der Rahmen-Host.
  if (n.typ === 'kosmetik') return kosmetikFuer(n.host, hostAus(sender.tab?.url) ?? n.host);
  if (n.typ === 'kosmetik.generisch') return { css: await generischesCss(n.listen) };
  if (n.typ === 'verwechslung.pruefen') return warnungFuer(n.host);
  if (n.typ === 'cookies.antwort') return { antwort: await cookieAntwort() };
  if (!ausEigenerOberflaeche(sender)) throw new ApiFehler('NICHT_ERLAUBT', '', 0);

  switch (n.typ) {
    case 'zustand':
      return zustand(n.tabId);

    case 'aktiv.setzen': {
      const { einstellungen } = await liesLokal('einstellungen');
      await schreibeLokal({ einstellungen: { ...einstellungen, aktiv: n.aktiv } });
      await allesAnwenden();
      return {};
    }

    case 'site.setzen': {
      const { sites } = await liesLokal('sites');
      const neu: Sites = { ...sites };
      if (n.erlaubt) neu[n.host] = { erlaubt: true, seit: Date.now() };
      else delete neu[n.host];
      await schreibeLokal({ sites: neu });
      await aktualisiereDynamischeRegeln();
      await allesAnwenden();
      return {};
    }

    case 'liste.setzen': {
      const listen = await listenInfo();
      const liste = listen.find((l) => l.id === n.id);
      if (!liste) throw new ApiFehler('LISTE_UNBEKANNT', '', 0);
      if (n.aktiv && liste.premium && !(await aktuelleLizenz()).premium) throw new ApiFehler('LIZENZ_ERFORDERLICH', '', 403);
      const { einstellungen } = await liesLokal('einstellungen');
      await schreibeLokal({ einstellungen: { ...einstellungen, listen: { ...einstellungen.listen, [n.id]: n.aktiv } } });
      await allesAnwenden();
      return {};
    }

    case 'konto.verbinden':
      return verbindungStarten();

    case 'konto.trennen':
      await kontoTrennen();
      return {};

    case 'lizenz.pruefen':
      return { lizenz: await lizenzPruefen('oberflaeche') };

    case 'premium.kaufen': {
      // Der Haken ist nie vorbelegt; sagt die Oberflaeche ausdruecklich
      // „nicht zugestimmt", faehrt hier nichts los.
      if (n.zustimmung === false) throw new ApiFehler('ZUSTIMMUNG_FEHLT', '', 0);
      const url = await checkoutUrl(n.interval);
      try {
        await api.tabs.create({ url });
      } catch {
        // Die Oberflaeche bekommt die Adresse und kann sie selbst oeffnen.
      }
      return { url };
    }

    case 'tarife.holen':
      return tarifeHolen();

    case 'meldung.vorschau':
      return meldungVorschau(n.tabId);

    case 'meldung.senden': {
      const seite = seiteOhneQuery(n.seite);
      if (!seite) throw new ApiFehler('KEINE_SEITE', '', 0);
      return meldungSenden({ seite, browser: n.browser, version: n.version, listen: n.listen, regeln: n.regeln }, n.kommentar);
    }

    case 'regeln.eigene.setzen': {
      await schreibeLokal({ eigeneRegeln: n.text });
      const { anzahl, fehler } = await aktualisiereDynamischeRegeln();
      return { anzahl, fehler };
    }

    case 'abgleich.jetzt':
      return abgleichJetzt();

    case 'listen.pflegen': {
      const ergebnis = await pflegeListen();
      // `null` heisst „darf nicht" (kein Premium, abgeschaltet). Das ist kein
      // Fehler, sondern eine Antwort - die Oberflaeche zeigt dann nichts an.
      return { ergebnis };
    }
  }
}

export function registriereNachrichten(): void {
  api.runtime.onMessage.addListener((roh: unknown, sender: Sender, sendResponse: (antwort: unknown) => void) => {
    const n = pruefeNachricht(roh);
    if (!n) {
      sendResponse({ ok: false, code: 'NACHRICHT_UNGUELTIG' });
      return false;
    }
    behandle(n, sender).then(
      (daten) => sendResponse(n.typ === 'kosmetik' || n.typ === 'kosmetik.generisch' ? daten : { ok: true, ...daten }),
      (e: unknown) => {
        const code = e instanceof ApiFehler ? e.code : 'INTERN';
        if (!(e instanceof ApiFehler)) console.warn('[AdSilence] Nachricht', n.typ, e);
        // Scheitert der Hintergrund, bleibt das Rauschen AN, nur ohne
        // Sitzungsbindung: Die Hauptwelt wuerfelt dann je Seite. Ein Fehler
        // hier darf den Schutz nicht abschalten, sonst waere ein voller
        // Speicher oder ein kaputtes Update der Weg um ihn herum.
        if (n.typ === 'kosmetik') sendResponse({ selektoren: [], textregeln: [], aus: false, listen: [], fingerabdruck: { an: true, token: null } });
        else if (n.typ === 'kosmetik.generisch') sendResponse({ css: '' });
        else sendResponse({ ok: false, code, grund: e instanceof Error ? e.message : undefined });
      },
    );
    // true: die Antwort kommt asynchron.
    return true;
  });
}
