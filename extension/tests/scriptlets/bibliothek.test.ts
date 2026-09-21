/**
 * Die Scriptlet-Bibliothek — ausgefuehrt, wie der Browser sie ausfuehrt.
 *
 * Bis zum 08.09.2026 gab es zu dieser Datei KEINEN Test. Sie ist die
 * Bibliothek, die in jeder fremden Seite laeuft; ein Fehler darin ist ein
 * Fehler auf der Seite des Kunden, und ein Werbeblocker, der Seiten kaputt
 * macht, wird abgeschaltet.
 *
 * Gepruefte Eigenschaft, die kein anderer Test haben kann: Die Bibliothek
 * wird SERIALISIERT. Sie geht als TEXT in die Seite. Deshalb laeuft sie hier
 * in einem `node:vm`-Kontext — einem fremden Fenster, in dem es nichts aus
 * diesem Modul gibt. Haengt sie an einem Import, einer Modulvariablen oder
 * einem Klassenhelfer von esbuild, faellt genau hier auf, was sonst erst der
 * Kunde saehe: „X is not defined", mitten auf seiner Seite.
 *
 * Die Fenster sind absichtlich karg. Ein Scriptlet muss auch dann etwas
 * Vernuenftiges tun, wenn die Seite `Response`, `MutationObserver` oder
 * `document` gar nicht hat — der Loader laeuft ab `document_start`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import { scriptletLoader, BEKANNTE_SCRIPTLETS, type ScriptletEintrag } from '../../src/scriptlets/bibliothek.ts';

type Welt = Record<string, unknown>;

/**
 * Ein Fenster mit dem Noetigsten. `ticke()` arbeitet ab, was der Loader an
 * `setTimeout` gegeben hat — so bleibt der Testablauf ohne echte Wartezeit
 * und ohne Zufall.
 */
function fenster(zusatz: Welt = {}): { welt: Welt; ticke: () => void } {
  const warteschlange: Array<() => void> = [];
  const welt: Welt = {
    addEventListener(): void {},
    setTimeout(cb: unknown): number {
      if (typeof cb === 'function') warteschlange.push(cb as () => void);
      return warteschlange.length;
    },
    clearTimeout(): void {},
    ...zusatz,
  };
  createContext(welt);
  const ticke = (): void => {
    // Mehrere Runden: ein Rueckruf darf einen neuen Timer stellen.
    for (let runde = 0; runde < 5 && warteschlange.length > 0; runde += 1) {
      for (const cb of warteschlange.splice(0, warteschlange.length)) cb();
    }
  };
  return { welt, ticke };
}

/** Den Loader als Text in das fremde Fenster geben — wie der Browser. */
function laufe(welt: Welt, eintraege: ScriptletEintrag[]): void {
  const fn = new Script(`(${scriptletLoader.toString()})`).runInContext(welt as object) as (e: ScriptletEintrag[]) => void;
  fn(eintraege);
}

function imFenster(welt: Welt, quelle: string): unknown {
  return new Script(quelle).runInContext(welt as object);
}

// ── Die Grundbedingung ─────────────────────────────────────────────────────

test('die Bibliothek laeuft als TEXT in einem fremden Fenster', () => {
  const { welt } = fenster();
  laufe(welt, [{ name: 'noeval', args: [] }]);
  assert.equal(typeof welt.eval, 'function');
  assert.equal((welt.eval as () => unknown)(), undefined, 'noeval muss eval entschaerft haben');
});

test('jedes bekannte Scriptlet laeuft ohne zu werfen, auch im kargen Fenster', () => {
  // Plausible Argumente je Name; die Namen kommen aus der Liste, nicht von
  // Hand — ein neues Scriptlet wird hier von selbst mitgeprueft.
  const args: Record<string, string[]> = {
    'abort-on-stack-trace': ['a.b', 'nirgends'],
    'no-xhr-if': ['/werbung/'],
    'no-fetch-if': ['/werbung/'],
    'remove-class': ['blocked', 'body', 'stay'],
    'json-prune': ['werbung'],
    'set-constant': ['a.b', 'true'],
    'abort-on-property-read': ['a.b'],
    'abort-on-property-write': ['a.b'],
    'abort-current-script': ['a.b', 'x'],
    'no-setTimeout-if': ['x'],
    'no-setInterval-if': ['x'],
    'prevent-addEventListener': ['click'],
  };
  for (const name of BEKANNTE_SCRIPTLETS) {
    const { welt, ticke } = fenster();
    assert.doesNotThrow(() => {
      laufe(welt, [{ name, args: args[name] ?? [] }]);
      ticke();
    }, `${name} wirft im kargen Fenster`);
  }
});

test('der Abbruch des ZWEITEN Aufrufs bleibt ebenfalls aus der Konsole', () => {
  // 106 Hosts bekommen Eintraege aus mehr als einer Liste, und je Liste laeuft
  // ein eigener Loader. Bis zum 08.09.2026 trug jeder Aufruf eine eigene
  // Kennung, waehrend der Fehlerlauscher nur einmal je Seite gesetzt wird:
  // Der Abbruch des zweiten Aufrufs stand danach als „Uncaught
  // ReferenceError" in der Konsole der Seite — sichtbar fuer jeden Detektor,
  // der `window.onerror` mitliest.
  const lauscher: Array<(ev: unknown) => void> = [];
  const { welt } = fenster({
    addEventListener(typ: unknown, cb: unknown): void {
      if (typ === 'error' && typeof cb === 'function') lauscher.push(cb as (ev: unknown) => void);
    },
  });

  laufe(welt, [{ name: 'aopr', args: ['ersteFalle'] }]);
  laufe(welt, [{ name: 'aopr', args: ['zweiteFalle'] }]);
  assert.equal(lauscher.length, 1, 'genau EIN Lauscher je Seite — darum geht es');

  for (const pfad of ['ersteFalle', 'zweiteFalle']) {
    let fehler: { message?: string } | undefined;
    try { imFenster(welt, pfad); } catch (e) { fehler = e as { message?: string }; }
    assert.ok(fehler, `${pfad} haette abbrechen muessen`);

    let verschluckt = false;
    lauscher[0]!({
      message: fehler.message,
      error: fehler,
      stopImmediatePropagation(): void {},
      preventDefault(): void { verschluckt = true; },
    });
    assert.ok(verschluckt, `der Abbruch von ${pfad} landet in der Konsole der Seite`);
  }
});

// ── Anti-Adblock: die Detektor-Bibliotheken ────────────────────────────────

test('nobab meldet nie eine Erkennung, aber immer das Gegenteil', () => {
  const { welt, ticke } = fenster();
  laufe(welt, [{ name: 'nobab', args: [] }]);

  const bab = welt.blockAdBlock as Record<string, (a?: unknown, b?: unknown) => unknown>;
  assert.equal(typeof bab, 'object', 'die Seite muss eine Instanz vorfinden');
  assert.equal(typeof welt.BlockAdBlock, 'function', 'auch der Konstruktor muss da sein');

  let erkannt = 0;
  let frei = 0;
  bab.onDetected(() => { erkannt += 1; });
  bab.onNotDetected(() => { frei += 1; });
  bab.check();
  ticke();

  assert.equal(erkannt, 0, 'der Erkennungsfall darf NIE feuern — er zeigt die Sperre');
  assert.equal(frei, 1, 'der Nicht-Erkennungsfall muss von selbst feuern, ohne dass die Seite prueft');
});

test('nofab traegt beide Namen und ueberlebt den Schreibversuch der Seite', () => {
  const { welt } = fenster();
  laufe(welt, [{ name: 'nofab', args: [] }]);
  const fab = welt.fuckAdBlock;
  assert.equal(typeof fab, 'object');

  // Die Seite laedt die echte Bibliothek und legt sie darueber. Der Versuch
  // muss verpuffen — sonst waere die Attrappe genau dann weg, wenn sie zaehlt.
  imFenster(welt, 'globalThis.fuckAdBlock = { onDetected: function (cb) { cb(); } };');
  assert.equal(welt.fuckAdBlock, fab, 'der Schreibversuch der Seite darf nicht durchkommen');

  // `new FuckAdBlock(...)` gibt dieselbe Attrappe zurueck.
  assert.equal(imFenster(welt, 'new FuckAdBlock({})'), fab);
});

test('abort-on-stack-trace bricht nur ab, wenn der Aufrufer im Stapel steht', () => {
  const { welt } = fenster({ zaehler: 7 });
  laufe(welt, [{ name: 'aost', args: ['zaehler', 'detektor'] }]);

  assert.equal(imFenster(welt, 'zaehler'), 7, 'ein unbeteiligter Leser bekommt den Wert');
  assert.throws(
    () => imFenster(welt, 'function detektor() { return zaehler; } detektor();'),
    'der benannte Aufrufer muss abbrechen',
  );
});

// ── Anti-Adblock: die Anfragen, an denen Detektoren messen ─────────────────

const XHR_FENSTER = `
  globalThis.gesendet = [];
  function XMLHttpRequest() { this.lauscher = []; }
  XMLHttpRequest.prototype.open = function (m, u) { this.m = m; this.u = u; };
  XMLHttpRequest.prototype.send = function () { globalThis.gesendet.push(this.u); };
  XMLHttpRequest.prototype.addEventListener = function (t, cb) { this.lauscher.push([t, cb]); };
  XMLHttpRequest.prototype.dispatchEvent = function (e) {
    for (var i = 0; i < this.lauscher.length; i += 1) if (this.lauscher[i][0] === e.type) this.lauscher[i][1](e);
  };
  Object.defineProperty(XMLHttpRequest.prototype, 'status', { configurable: true, get: function () { return 0; } });
  Object.defineProperty(XMLHttpRequest.prototype, 'responseText', { configurable: true, get: function () { return 'echt'; } });
  function Event(typ) { this.type = typ; }
  globalThis.XMLHttpRequest = XMLHttpRequest;
  globalThis.Event = Event;
`;

test('no-xhr-if laesst die passende Anfrage ausfallen und die andere durch', () => {
  const { welt, ticke } = fenster();
  imFenster(welt, XHR_FENSTER);
  laufe(welt, [{ name: 'no-xhr-if', args: ['/werbung/'] }]);

  const probe = imFenster(welt, `
    var treffer = new XMLHttpRequest();
    var gesehen = 0;
    treffer.addEventListener('load', function () { gesehen = treffer.status; });
    treffer.open('GET', 'https://beispiel.de/werbung/anzeige.js');
    treffer.send();
    var andere = new XMLHttpRequest();
    andere.open('GET', 'https://beispiel.de/inhalt.json');
    andere.send();
    ({ text: treffer.responseText, status: function () { return gesehen; } });
  `) as { text: string; status: () => number };

  assert.deepEqual(
    [...(welt.gesendet as string[])],
    ['https://beispiel.de/inhalt.json'],
    'nur die unbeteiligte Anfrage darf wirklich rausgehen',
  );
  assert.equal(probe.text, '', 'die abgefangene Anfrage traegt einen leeren Rumpf');
  assert.equal(probe.status(), 0, 'vor dem Tick ist noch nichts gemeldet');
  ticke();
  assert.equal(probe.status(), 200, 'der Detektor sieht eine GEGLUECKTE Anfrage — nicht einen Fehler');
});

test('no-fetch-if beantwortet die passende Anfrage selbst, mit Status 200', async () => {
  const gerufen: string[] = [];
  const { welt } = fenster({
    Response,
    fetch: (u: unknown): Promise<string> => { gerufen.push(String(u)); return Promise.resolve('echt'); },
  });
  laufe(welt, [{ name: 'no-fetch-if', args: ['/zaehler/', 'emptyObj'] }]);
  const hole = welt.fetch as (u: string) => Promise<Response>;

  const abgefangen = await hole('https://beispiel.de/zaehler/pixel');
  assert.equal(abgefangen.ok, true, 'ein Fehler waere der Beweis, den der Detektor sucht');
  assert.equal(abgefangen.status, 200);
  assert.equal(await abgefangen.text(), '{}', 'emptyObj muss ein leeres Objekt liefern');
  assert.deepEqual([...gerufen], [], 'die passende Anfrage darf den Browser nicht verlassen');

  await hole('https://beispiel.de/bild.png');
  assert.deepEqual([...gerufen], ['https://beispiel.de/bild.png'], 'alles andere geht unveraendert durch');
});

// ── Die Sperren, die auf dem Body liegen ───────────────────────────────────

const DOM_FENSTER = `
  function Knoten(klassen) {
    var selbst = this;
    this.klassen = klassen.slice();
    this.classList = { remove: function (k) {
      var i = selbst.klassen.indexOf(k);
      if (i !== -1) selbst.klassen.splice(i, 1);
    } };
  }
  globalThis.knoten = [new Knoten(['blocked', 'inhalt']), new Knoten(['inhalt'])];
  globalThis.document = {
    documentElement: {},
    addEventListener: function () {},
    getElementsByClassName: function (k) {
      return globalThis.knoten.filter(function (n) { return n.klassen.indexOf(k) !== -1; });
    },
    querySelectorAll: function () { return globalThis.knoten; },
  };
`;

test('remove-class nimmt die Sperrklasse weg und laesst den Rest stehen', () => {
  const { welt } = fenster();
  imFenster(welt, DOM_FENSTER);
  laufe(welt, [{ name: 'rc', args: ['blocked'] }]);
  // `[...]` aussen: die Liste kommt aus dem VM-Fenster, und deepEqual
  // vergleicht auch den Prototyp — der ist dort ein anderer.
  const stand = [...(welt.knoten as { klassen: string[] }[])].map((n) => [...n.klassen]);
  assert.deepEqual(stand, [['inhalt'], ['inhalt']]);
});

test('json-prune schneidet auch aus einer XHR-Antwort', () => {
  const { welt } = fenster();
  imFenster(welt, `
    function XMLHttpRequest() {}
    Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
      configurable: true,
      get: function () { return '{"daten":1,"werbung":{"id":9}}'; },
    });
    globalThis.XMLHttpRequest = XMLHttpRequest;
  `);
  laufe(welt, [{ name: 'json-prune', args: ['werbung'] }]);
  assert.equal(
    imFenster(welt, 'new XMLHttpRequest().responseText'),
    '{"daten":1}',
    'der Weg ueber responseText ging bis zum 08.09.2026 an json-prune vorbei',
  );
});
