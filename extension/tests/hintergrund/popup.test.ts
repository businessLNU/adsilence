/**
 * Der Popunder-Waechter: schliesst er den richtigen Tab — und NUR den?
 *
 * Der teure Fehler ist hier nicht der durchgelassene Popunder, sondern der
 * geschlossene Tab, den jemand wollte. Deshalb pruefen die meisten Faelle
 * unten, wann NICHT geschlossen wird.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installiereApi } from './attrappe.ts';

type Lauscher = (d: { tabId: number; sourceTabId: number; url: string }) => void;
type NavLauscher = (d: { tabId: number; frameId: number; url: string }) => void;

/** Ein Fenster mit Listen, Tabs und einem Netz, das das Paket ausliefert. */
async function baueWelt(zusatz: { aktiv?: boolean; erlaubteSeite?: string } = {}) {
  let beiZiel: Lauscher | null = null;
  let beiNavigation: NavLauscher | null = null;
  const geschlossen: number[] = [];
  const tabs = new Map<number, { url: string }>([[1, { url: 'https://streaming.beispiel/film' }]]);

  const umgebung = installiereApi({
    lokal: {
      einstellungen: { aktiv: zusatz.aktiv ?? true, listen: { basis: true } },
      sites: zusatz.erlaubteSeite ? { [zusatz.erlaubteSeite]: { erlaubt: true } } : {},
      lizenz: null,
    },
    api: {
      // `listenInfo()` nimmt nur Listen, die auch als Regelsatz im Manifest
      // stehen. Ohne diesen Zweig ist die Hostliste leer -- und dann bestehen
      // ausgerechnet die Faelle, die NICHT schliessen sollen, aus dem
      // falschen Grund. Genau so ist es beim ersten Lauf passiert.
      runtime: {
        getURL: (pfad: string) => `chrome-extension://attrappe/${pfad}`,
        getManifest: () => ({ declarative_net_request: { rule_resources: [{ id: 'basis' }] } }),
      },
      webNavigation: {
        onCreatedNavigationTarget: { addListener: (cb: Lauscher) => { beiZiel = cb; } },
        onCommitted: { addListener: (cb: NavLauscher) => { beiNavigation = cb; } },
      },
      tabs: {
        get: async (id: number) => {
          const t = tabs.get(id);
          if (!t) throw new Error('kein Tab');
          return t;
        },
        remove: async (id: number) => { geschlossen.push(id); },
        onRemoved: { addListener: () => {} },
      },
    },
  });

  umgebung.netz.antworte('listen/quellen.json', 200, [
    { id: 'basis', name: 'EasyList', premium: false, standard: true },
  ]);
  umgebung.netz.antworte('popup/basis.json', 200, {
    hosts: ['adfoc.us', 'popunder.beispiel'],
    ausnahmen: [],
  });

  const modul = await import('../../src/hintergrund/popup.ts');
  modul.popupsNeuLaden();
  modul.registrierePopupWaechter();
  assert.ok(beiZiel, 'der Waechter muss sich fuer neue Ziele anmelden');

  /** Eine Seite macht einen Tab auf; danach ist alles abgearbeitet. */
  const oeffne = async (tabId: number, url: string, quelle = 1) => {
    beiZiel!({ tabId, sourceTabId: quelle, url });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  const navigiere = async (tabId: number, url: string) => {
    beiNavigation!({ tabId, frameId: 0, url });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { oeffne, navigiere, geschlossen };
}

test('ein Tab auf einen Popunder-Host geht wieder zu', async () => {
  const w = await baueWelt();
  await w.oeffne(7, 'https://adfoc.us/serve/1234');
  assert.deepEqual(w.geschlossen, [7]);
});

test('auch eine Unterdomain zaehlt', async () => {
  const w = await baueWelt();
  await w.oeffne(7, 'https://go.adfoc.us/serve');
  assert.deepEqual(w.geschlossen, [7]);
});

test('ein Tab auf eine unbeteiligte Adresse bleibt offen', async () => {
  const w = await baueWelt();
  await w.oeffne(7, 'https://wikipedia.org/wiki/Katze');
  assert.deepEqual(w.geschlossen, []);
});

test('bei ausgeschaltetem Hauptschalter wird nichts geschlossen', async () => {
  const w = await baueWelt({ aktiv: false });
  await w.oeffne(7, 'https://adfoc.us/serve');
  assert.deepEqual(w.geschlossen, []);
});

test('eine Ausnahme fuer die OEFFNENDE Seite haelt den Tab offen', async () => {
  // Wer AdSilence auf einer Seite abschaltet, will dort auch keine
  // geschlossenen Tabs — die Ausnahme gilt dem Oeffner, nicht dem Ziel.
  const w = await baueWelt({ erlaubteSeite: 'streaming.beispiel' });
  await w.oeffne(7, 'https://adfoc.us/serve');
  assert.deepEqual(w.geschlossen, []);
});

test('der Umweg ueber about:blank wird bei der ersten Navigation erwischt', async () => {
  // Der verbreitete Popunder oeffnet leer und setzt danach `location`.
  const w = await baueWelt();
  await w.oeffne(7, 'about:blank');
  assert.deepEqual(w.geschlossen, [], 'beim leeren Tab ist noch nichts zu entscheiden');
  await w.navigiere(7, 'https://popunder.beispiel/ziel');
  assert.deepEqual(w.geschlossen, [7]);
});

test('eine Umleitungskette wird am ENDE erwischt, nicht am Anfang', async () => {
  // GEMESSEN am 08.09.2026 auf aniworld.to: Der Popunder ging ueber einen
  // Zwischenhost auf, der in keiner Liste steht, und landete erst per 302
  // auf cruzswim.org. Bis dahin pruefte der Waechter nur die erste Adresse
  // -- und liess den Tab stehen.
  const w = await baueWelt();
  await w.oeffne(7, 'https://zwischenhost.beispiel/weiter');
  assert.deepEqual(w.geschlossen, [], 'der Zwischenhost steht in keiner Liste');
  await w.navigiere(7, 'https://noch-einer.beispiel/weiter');
  assert.deepEqual(w.geschlossen, [], 'auch das zweite Glied nicht');
  await w.navigiere(7, 'https://popunder.beispiel/ziel');
  assert.deepEqual(w.geschlossen, [7], 'das letzte Glied ist der Popunder');
});

test('eine Navigation in einem Tab, den keine Seite aufmachte, wird nicht angefasst', async () => {
  const w = await baueWelt();
  await w.navigiere(9, 'https://adfoc.us/serve');
  assert.deepEqual(w.geschlossen, [], 'ohne Oeffner ist es die Adresszeile des Nutzers');
});
