/**
 * `src/inhalt/fingerabdruck-kern.ts`: das Rauschen, ohne Browser.
 *
 * Was hier haengt: Jede Zahl, die der Kern ausgibt, sieht jede Seite. Ein
 * Rauschen, das nicht idempotent ist, laesst Bilder in Lese-Schreib-
 * Schleifen driften; eines, das Alpha anfasst, macht halbtransparente
 * Pixel kaputt; eines mit Muster (misch(s, 1, 2) === misch(s, 2, 1)) ist
 * selbst ein Merkmal. Dazu die Tarnkappe: Sie patcht
 * `Function.prototype.toString` im ganzen Prozess, deshalb steht ihr Test in
 * derselben Datei und `node --test` faehrt jede Datei in einem eigenen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KERNE_WERTE,
  KOPIE_MAX_PIXEL,
  PIXEL_BUDGET,
  PROBEN_BUDGET,
  PROBEN_DELTA,
  VERBOTENE_PLUGIN_BEGRIFFE,
  darfKopieren,
  hash32,
  istReinfarbe,
  kerneAus,
  misch,
  normiereBereich,
  pluginAus,
  probenschritt,
  seedAus,
  verrauscheBild,
  verrauschePixel,
  verrauscheProben,
  zeilenschritt,
} from '../../src/inhalt/fingerabdruck-kern.ts';
import { tarne } from '../../src/inhalt/tarnkappe.ts';

/** Ein deterministisches Testbild, alle Pixel deckend. */
function bild(breite: number, hoehe: number, alpha = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(breite * hoehe * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = (i * 7) & 0xff;
    d[i + 1] = (i * 13) & 0xff;
    d[i + 2] = (i * 29) & 0xff;
    d[i + 3] = alpha;
  }
  return d;
}

function popcount(n: number): number {
  let z = 0;
  for (let v = n >>> 0; v; v >>>= 1) z += v & 1;
  return z;
}

// ── Hashes und Mischer ─────────────────────────────────────────────────────

test('hash32 ist FNV-1a mit den bekannten Pruefwerten', () => {
  assert.equal(hash32(''), 0x811c9dc5);
  assert.equal(hash32('a'), 0xe40c292c);
  assert.equal(hash32('foobar'), 0xbf9cf968);
});

test('misch ist deterministisch und liefert eine vorzeichenlose 32-Bit-Zahl', () => {
  for (const s of [0, 1, 0xffffffff, 12345, -7]) {
    for (const [x, y] of [
      [0, 0],
      [3, 5],
      [-1, 2],
      [1 << 30, -(1 << 30)],
    ] as const) {
      const a = misch(s, x, y);
      assert.equal(a, misch(s, x, y));
      assert.ok(a >= 0 && a <= 0xffffffff && Number.isInteger(a));
    }
  }
});

test('misch ist nicht kommutativ in x und y', () => {
  // Waere es das, laege das Rauschen symmetrisch zur Diagonalen.
  for (let s = 0; s < 200; s++) {
    assert.notEqual(misch(s, 1, 2), misch(s, 2, 1), `Seed ${s}`);
    assert.notEqual(misch(s, 7, 100), misch(s, 100, 7), `Seed ${s}`);
  }
});

test('ueber eine Million Positionen ist jedes Kanalbit zur Haelfte gesetzt', () => {
  const zaehler = [0, 0, 0];
  const n = 1_000_000;
  const seed = hash32('probe');
  for (let i = 0; i < n; i++) {
    const m = misch(seed, i % 1000, Math.floor(i / 1000));
    zaehler[0]! += m & 1;
    zaehler[1]! += (m >>> 1) & 1;
    zaehler[2]! += (m >>> 2) & 1;
  }
  for (const z of zaehler) {
    const anteil = z / n;
    assert.ok(anteil > 0.49 && anteil < 0.51, `Anteil ${anteil}`);
  }
});

test('benachbarte Positionen unterscheiden sich in rund 16 Bit (Lawine)', () => {
  let summe = 0;
  const n = 100_000;
  const seed = hash32('lawine');
  for (let i = 0; i < n; i++) {
    summe += popcount(misch(seed, i, 42) ^ misch(seed, i + 1, 42));
  }
  const mittel = summe / n;
  assert.ok(mittel > 15 && mittel < 17, `Mittel ${mittel}`);
});

test('seedAus ist stabil und trennt Hosts', () => {
  assert.equal(seedAus('t', 'a.example'), seedAus('t', 'a.example'));
  assert.notEqual(seedAus('t', 'a.example'), seedAus('t', 'b.example'));
  assert.notEqual(seedAus('t', 'a.example'), seedAus('u', 'a.example'));
});

// ── Pixel ──────────────────────────────────────────────────────────────────

test('jeder Kanal weicht hoechstens um 1 ab, Alpha bleibt bitgleich', () => {
  const b = 64;
  const original = bild(b, b);
  const d = new Uint8ClampedArray(original);
  verrauschePixel(d, b, b, 1234, b * b);
  let geaendert = 0;
  for (let i = 0; i < d.length; i += 4) {
    for (const k of [0, 1, 2]) {
      assert.ok(Math.abs(d[i + k]! - original[i + k]!) <= 1);
      if (d[i + k] !== original[i + k]) geaendert++;
    }
    assert.equal(d[i + 3], original[i + 3]);
  }
  assert.ok(geaendert > 0, 'es hat sich nichts geaendert');
});

test('300-faches Anwenden ist bitgleich mit einmaligem (Idempotenz)', () => {
  const b = 32;
  const einmal = bild(b, b);
  verrauschePixel(einmal, b, b, 99, b * b);
  const oft = bild(b, b);
  for (let i = 0; i < 300; i++) verrauschePixel(oft, b, b, 99, b * b);
  assert.deepEqual(oft, einmal);
});

test('Pixel mit Alpha != 255 bleiben bitgleich', () => {
  const b = 16;
  for (const alpha of [0, 1, 3, 128, 254]) {
    const original = bild(b, b, alpha);
    const d = new Uint8ClampedArray(original);
    verrauschePixel(d, b, b, 5, b * b);
    assert.deepEqual(d, original, `Alpha ${alpha}`);
  }
});

test('Reinfarben bleiben bitgleich: die acht Ecken des Farbwuerfels', () => {
  const ecken = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
  ];
  for (const [r, g, b] of ecken) assert.equal(istReinfarbe(r!, g!, b!), true);
  for (const [r, g, b] of [
    [254, 0, 0],
    [255, 1, 0],
    [128, 128, 128],
    [255, 102, 0],
    [0, 102, 153],
  ]) {
    assert.equal(istReinfarbe(r!, g!, b!), false);
  }
  const w = 32;
  const d = new Uint8ClampedArray(w * w * 4);
  for (let p = 0; p < w * w; p++) {
    const e = ecken[p % ecken.length]!;
    d.set([e[0]!, e[1]!, e[2]!, 255], p * 4);
  }
  const original = new Uint8ClampedArray(d);
  verrauschePixel(d, w, w, 4711, w * w);
  assert.deepEqual(d, original);
});

test('Schriftmessung wie Phaser 3 und PixiJS 7: ascent und descent bleiben richtig', () => {
  // MeasureText.js: Canvas rot fuellen, Text schwarz malen, von oben und
  // unten die erste Zeile mit einem Pixel R !== 255 suchen. Nachgebaut:
  // roter Grund, ein Glyph als schwarzer Block mit grauen Kanten (Antialiasing)
  // in den Zeilen 10..19, Grundlinie 18.
  const w = 40;
  const h = 30;
  const grundlinie = 18;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) d.set([255, 0, 0, 255], p * 4);
  for (let y = 10; y < 20; y++) {
    for (let x = 5; x < 25; x++) {
      const kante = y === 10 || y === 19 || x === 5 || x === 24;
      d.set(kante ? [128, 0, 0, 255] : [0, 0, 0, 255], (y * w + x) * 4);
    }
  }
  const messe = (pixel: Uint8ClampedArray) => {
    const zeile = w * 4;
    let oben = 0;
    for (let y = 0; y < grundlinie; y++) {
      let stop = false;
      for (let j = 0; j < zeile; j += 4) if (pixel[y * zeile + j] !== 255) stop = true;
      if (stop) break;
      oben++;
    }
    let unten = h;
    for (let y = h - 1; y > grundlinie; y--) {
      let stop = false;
      for (let j = 0; j < zeile; j += 4) if (pixel[y * zeile + j] !== 255) stop = true;
      if (stop) break;
      unten--;
    }
    return { ascent: grundlinie - oben, descent: unten - grundlinie };
  };
  const ohne = messe(d);
  assert.deepEqual(ohne, { ascent: 8, descent: 2 }, 'die Messung selbst stimmt');
  const mit = new Uint8ClampedArray(d);
  verrauschePixel(mit, w, h, hash32('phaser'), w * h);
  assert.deepEqual(messe(mit), ohne);
  // Und die Kanten des Glyphs tragen weiter Rauschen - dort liegt die Entropie.
  let kantenGeaendert = 0;
  for (let x = 6; x < 24; x++) if (mit[(10 * w + x) * 4] !== 128) kantenGeaendert++;
  assert.ok(kantenGeaendert > 3, `nur ${kantenGeaendert} Kantenpixel geaendert`);
});

test('ein Pixel, das durch das Bit zur Reinfarbe wird, bleibt beim zweiten Mal stehen (Idempotenz)', () => {
  // (254, 0, 0) kann zu (255, 0, 0) werden; der zweite Durchlauf laesst die
  // Reinfarbe in Ruhe und liefert dasselbe wie der erste.
  const w = 64;
  const d = new Uint8ClampedArray(w * w * 4);
  for (let p = 0; p < w * w; p++) d.set([254, 0, 0, 255], p * 4);
  const einmal = new Uint8ClampedArray(d);
  verrauschePixel(einmal, w, w, 99, w * w);
  let reinGeworden = 0;
  for (let p = 0; p < w * w; p++) if (einmal[p * 4] === 255) reinGeworden++;
  assert.ok(reinGeworden > w * w * 0.4, `nur ${reinGeworden} Pixel wurden 255`);
  const oft = new Uint8ClampedArray(d);
  for (let i = 0; i < 5; i++) verrauschePixel(oft, w, w, 99, w * w);
  assert.deepEqual(oft, einmal);
});

test('ein leeres Bild bleibt bitgleich leer', () => {
  const d = new Uint8ClampedArray(16 * 16 * 4);
  verrauschePixel(d, 16, 16, 5, 256);
  assert.ok(d.every((v) => v === 0));
});

test('ein Float16-Puffer wird nicht angefasst', () => {
  const F16 = (globalThis as { Float16Array?: new (n: number) => { length: number; [i: number]: number } }).Float16Array;
  const data = F16 ? new F16(16) : new Float32Array(16);
  for (let i = 0; i < 16; i++) data[i] = i / 16;
  const vorher = Array.from(data as ArrayLike<number>);
  assert.equal(verrauscheBild({ data, width: 2, height: 2 }, 7, 4), false);
  assert.deepEqual(Array.from(data as ArrayLike<number>), vorher);
  // Und der normale Weg rauscht.
  assert.equal(verrauscheBild({ data: bild(2, 2), width: 2, height: 2 }, 7, 4), true);
});

test('Teilbereich gleich Vollbild an derselben Position', () => {
  const b = 64;
  const voll = bild(b, b);
  verrauschePixel(voll, b, b, 4711, b * b);

  const x0 = 10;
  const y0 = 20;
  const w = 16;
  const h = 12;
  const teil = new Uint8ClampedArray(w * h * 4);
  const original = bild(b, b);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) teil[y * w * 4 + x] = original[(y0 + y) * b * 4 + x0 * 4 + x]!;
  verrauschePixel(teil, w, h, 4711, b * b, x0, y0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w * 4; x++) {
      assert.equal(teil[y * w * 4 + x], voll[(y0 + y) * b * 4 + x0 * 4 + x], `bei ${x},${y}`);
    }
  }
});

test('negative Ausdehnung ergibt denselben Ursprung wie die positive Form', () => {
  assert.deepEqual(normiereBereich(30, 40, -20, -20), { x0: 10, y0: 20 });
  assert.deepEqual(normiereBereich(10, 20, 20, 20), { x0: 10, y0: 20 });
  // WebIDL long: Strings werden gewandelt, Brueche abgeschnitten, NaN wird 0.
  assert.deepEqual(normiereBereich('10', 0.9, 5, 5), { x0: 10, y0: 0 });
  assert.deepEqual(normiereBereich(NaN, undefined, 1, 1), { x0: 0, y0: 0 });
  assert.deepEqual(normiereBereich(-5, -7, 10, 10), { x0: -5, y0: -7 });
});

test('ein Bereich mit negativem Ursprung ist deterministisch und laesst Aussenpixel in Ruhe', () => {
  // Was ausserhalb des Canvas liegt, liefert der Browser als transparentes
  // Schwarz; hier die linke obere Ecke.
  const w = 10;
  const h = 10;
  const mach = () => {
    const d = bild(w, h);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) d[(y * w + x) * 4 + 3] = 0;
    return d;
  };
  const a = mach();
  const b = mach();
  verrauschePixel(a, w, h, 8, 100, -5, -5);
  verrauschePixel(b, w, h, 8, 100, -5, -5);
  assert.deepEqual(a, b);
  const original = mach();
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) for (let k = 0; k < 4; k++) assert.equal(a[(y * w + x) * 4 + k], original[(y * w + x) * 4 + k]);
  assert.notDeepEqual(a, original);
});

test('ueber PIXEL_BUDGET wird nur jede k-te Zeile bearbeitet', () => {
  assert.equal(zeilenschritt(1), 1);
  assert.equal(zeilenschritt(PIXEL_BUDGET), 1);
  assert.equal(zeilenschritt(PIXEL_BUDGET + 1), 2);
  assert.equal(zeilenschritt(PIXEL_BUDGET * 4), 4);

  // Ein 8x8-Ausschnitt eines Canvas mit 2 * PIXEL_BUDGET Pixeln, Ursprung
  // bei y0 = 3: Die absoluten Zeilen 3, 5, 7, ... bleiben, 4, 6, 8, ... rauschen.
  const w = 8;
  const h = 8;
  const original = bild(w, h);
  const d = new Uint8ClampedArray(original);
  verrauschePixel(d, w, h, 1, PIXEL_BUDGET * 2, 0, 3);
  for (let y = 0; y < h; y++) {
    const zeileGleich = d.slice(y * w * 4, (y + 1) * w * 4).every((v, i) => v === original[y * w * 4 + i]);
    const absolut = 3 + y;
    if (absolut % 2 !== 0) assert.ok(zeileGleich, `Zeile ${absolut} sollte unveraendert sein`);
    else assert.ok(!zeileGleich, `Zeile ${absolut} sollte Rauschen tragen`);
  }
});

test('darfKopieren an der Grenze', () => {
  assert.equal(darfKopieren(0, 10), false);
  assert.equal(darfKopieren(10, 0), false);
  assert.equal(darfKopieren(-1, 10), false);
  assert.equal(darfKopieren(1, 1), true);
  assert.equal(darfKopieren(4096, 4096), true);
  assert.equal(darfKopieren(4096, 4097), false);
  assert.equal(4096 * 4096, KOPIE_MAX_PIXEL);
});

// ── Audioproben ────────────────────────────────────────────────────────────

/** Abweichung, die Float32 selbst bei der Speicherung erzwingt: ein Schritt des Werts. */
function schrittweite(x: number): number {
  return Math.abs(x) * 2 ** -23;
}

test('Audioproben weichen hoechstens um PROBEN_DELTA plus einen Float32-Schritt ab', () => {
  for (const [von, bis] of [
    [-0.25, 0.25],
    [0.9, 1.0],
    [-1.0, -0.9],
  ] as const) {
    const n = 5000;
    const original = new Float32Array(n);
    for (let i = 0; i < n; i++) original[i] = von + ((bis - von) * i) / n;
    const d = new Float32Array(original);
    verrauscheProben(d, hash32('audio'));
    let geaendert = 0;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(d[i]! - original[i]!);
      assert.ok(diff <= PROBEN_DELTA + schrittweite(original[i]!), `Probe ${i}: ${diff}`);
      if (diff > 0) geaendert++;
    }
    assert.ok(geaendert > n / 2, `nur ${geaendert} von ${n} Proben im Bereich ${von}..${bis} geaendert`);
  }
});

test('Proben, die exakt 0 sind, bleiben 0: Stille bleibt Stille', () => {
  // `while (d[i] === 0) i++` schneidet fuehrende Stille ab; ein frischer
  // `createBuffer` ist lauter Nullen.
  const n = 2000;
  const d = new Float32Array(n);
  for (let i = 1000; i < n; i++) d[i] = 0.3;
  verrauscheProben(d, hash32('stille'));
  let start = 0;
  while (start < n && d[start] === 0) start++;
  assert.equal(start, 1000);
  let geaendert = 0;
  for (let i = 1000; i < n; i++) if (d[i] !== Math.fround(0.3)) geaendert++;
  assert.ok(geaendert > 400, `nur ${geaendert} von 1000 Proben hinter der Stille geaendert`);
  const leer = new Float32Array(1000);
  verrauscheProben(leer, 5);
  assert.ok(leer.every((v) => v === 0));
});

test('Audioproben sind deterministisch, und ein Teilstueck gleicht dem Ganzen', () => {
  const n = 1000;
  const ganz = new Float32Array(n).fill(0.1);
  verrauscheProben(ganz, 77);
  const ganz2 = new Float32Array(n).fill(0.1);
  verrauscheProben(ganz2, 77);
  assert.deepEqual(ganz, ganz2);

  const teil = new Float32Array(100).fill(0.1);
  verrauscheProben(teil, 77, 300, n);
  assert.deepEqual(teil, ganz.slice(300, 400));
});

test('ueber PROBEN_BUDGET wird nur jede k-te Probe bearbeitet', () => {
  assert.equal(probenschritt(PROBEN_BUDGET), 1);
  assert.equal(probenschritt(PROBEN_BUDGET + 1), 2);
  // Bei 0.1 ist die Float32-Schrittweite (1.2e-8) klein gegen das Delta;
  // bei 0.5 (6e-8) rundete rund ein Drittel der Deltas auf den alten Wert
  // zurueck, und der Test zaehlte die Rundung statt des Schritts.
  const wert = Math.fround(0.1);
  const d = new Float32Array(PROBEN_BUDGET * 2).fill(wert);
  verrauscheProben(d, 3);
  for (let i = 0; i < 2000; i++) {
    if (i % 2 === 1) assert.equal(d[i], wert, `Probe ${i}`);
  }
  let geaendert = 0;
  for (let i = 0; i < 2000; i += 2) if (d[i] !== wert) geaendert++;
  assert.ok(geaendert > 900, `nur ${geaendert} von 1000`);

  // Ein Teilstueck mit Start, der kein Vielfaches von k ist: dieselben
  // absoluten Indizes rauschen wie im Ganzen (Schrittschleife statt
  // `continue`).
  const k = probenschritt(PROBEN_BUDGET * 3);
  assert.equal(k, 3);
  const ganz = new Float32Array(300).fill(wert);
  verrauscheProben(ganz, 3, 0, PROBEN_BUDGET * 3);
  for (const start of [0, 1, 2, 3, 7]) {
    const teil = new Float32Array(100).fill(wert);
    verrauscheProben(teil, 3, start, PROBEN_BUDGET * 3);
    assert.deepEqual(teil, ganz.slice(start, start + 100), `Start ${start}`);
  }
});

// ── Tarnkappe ──────────────────────────────────────────────────────────────

test('die Tarnkappe liefert fuer Huellen den nativen Text und laesst alles andere in Ruhe', () => {
  const echt = Array.prototype.indexOf;
  const nativerText = Function.prototype.toString.call(echt);
  const huelle = {
    indexOf(this: unknown[], ...a: unknown[]) {
      return Reflect.apply(echt, this, a);
    },
  }.indexOf;
  const fremd = function fremd() {
    return 1;
  };
  const fremdText = fremd.toString();

  tarne(huelle, echt);

  assert.equal(huelle.toString(), nativerText);
  assert.equal(Function.prototype.toString.call(huelle), nativerText);
  assert.equal(huelle.name, 'indexOf');
  assert.equal(huelle.length, echt.length);
  assert.equal(fremd.toString(), fremdText, 'nicht registrierte Funktionen bleiben lesbar');
  assert.equal(Function.prototype.toString.toString(), 'function toString() { [native code] }');
  assert.throws(() => Function.prototype.toString.call({}), TypeError);
  assert.equal('prototype' in huelle, false);
  assert.deepEqual(Object.getOwnPropertyNames(huelle), ['length', 'name']);
  const desk = Object.getOwnPropertyDescriptor(Function.prototype, 'toString')!;
  assert.equal(desk.enumerable, false);
  assert.equal(desk.writable, true);
});

test('die Tarnkappe erkennt eine Huelle aus einem fremden Realm am Quelltext', () => {
  // Ein same-origin Rahmen bringt dieselbe Huelle mit eigener Registrierung.
  // Nachgebaut: eine ZWEITE Funktion mit demselben Quelltext und Namen, die
  // nie registriert wurde (so sieht die Huelle des Elternfensters aus der
  // Sicht der Tarnkappe im Rahmen aus).
  const echt = Array.prototype.indexOf;
  const nativerText = Function.prototype.toString.call(echt);
  const bauen = () =>
    ({
      indexOf(this: unknown[], ...a: unknown[]) {
        return Reflect.apply(echt, this, a);
      },
    }).indexOf;
  const eigene = bauen();
  tarne(eigene, echt);
  const fremde = bauen();
  Object.defineProperty(fremde, 'name', { value: 'indexOf', configurable: true });
  assert.equal(fremde.toString(), nativerText, 'gleicher Quelltext, gleicher Name: nativer Text');
  // Gleicher Quelltext, aber ein Name, den keine Huelle traegt: bleibt lesbar.
  const anders = bauen();
  Object.defineProperty(anders, 'name', { value: 'gibtEsNicht', configurable: true });
  assert.notEqual(anders.toString(), nativerText);
  assert.ok(anders.toString().includes('Reflect.apply'));
});

// ── Kernzahl und Plugin je Site (Nachtrag Cover Your Tracks) ───────────────
// Cover Your Tracks zaehlt nur Unterschiede ZWISCHEN seinen zwei Domains;
// beide Werte kommen deshalb aus dem Seed der Site, nicht aus einem Salz je
// Element. Was hier haengt: Ein Wert ausserhalb {2, 4, 8} waere ein
// Merkmal, ein Plugin-Name mit „pdf" oder „java" liesse Erkennungscode
// etwas ansprechen, das es nicht gibt, und beides muss bei gleichem Seed
// bitgleich wiederkommen, sonst zaehlt FingerprintJS „unstable".

test('kerneAus liefert nur Werte aus KERNE_WERTE, deterministisch, und trifft alle drei', () => {
  assert.deepEqual([...KERNE_WERTE], [2, 4, 8]);
  const gesehen = new Set<number>();
  for (let i = 0; i < 3000; i++) {
    const seed = hash32(`site-${i}`);
    const k = kerneAus(seed);
    assert.ok((KERNE_WERTE as readonly number[]).includes(k), `Seed ${seed}: ${k}`);
    assert.equal(kerneAus(seed), k);
    gesehen.add(k);
  }
  assert.equal(gesehen.size, KERNE_WERTE.length, `nur ${[...gesehen]} gesehen`);
  // Zwei Sites derselben Sitzung: derselbe Weg wie im Skript.
  assert.equal(kerneAus(seedAus('t', 'a.example')), kerneAus(seedAus('t', 'a.example')));
});

test('pluginAus hat die vereinbarte Form: zwei Pseudowoerter, Name, Beschreibung, Datei, MimeType, Endung', () => {
  const wortMuster = /^[bdfgklmnprstvz][aeiou](?:[bdfgklmnprstvz][aeiou]){1,2}[bdfgklmnprstvz]?$/;
  for (let i = 0; i < 500; i++) {
    const p = pluginAus(hash32(`form-${i}`));
    const teile = p.name.split(' ');
    assert.equal(teile.length, 2, p.name);
    const [w1, w2] = teile as [string, string];
    for (const w of [w1, w2]) {
      assert.match(w, /^[A-Z][a-z]{4,6}$/, w);
      assert.match(w.toLowerCase(), wortMuster, `kein Konsonant-Vokal-Muster: ${w}`);
    }
    assert.notEqual(w1, w2, p.name);
    const k1 = w1.toLowerCase();
    const k2 = w2.toLowerCase();
    assert.equal(p.beschreibung, `${w1} ${w2} Plugin`);
    assert.equal(p.datei, `${k1}-${k2}.plugin`);
    assert.equal(p.mimeTyp, `application/x-${k1}-${k2}`);
    assert.equal(p.endung, k1);
  }
});

test('pluginAus traegt nie einen verbotenen Begriff, in keinem Feld', () => {
  // Die Liste im Kern ist die eine Quelle; hier nur die Gegenprobe, dass
  // sie die Begriffe aus dem Vertrag enthaelt.
  for (const b of ['pdf', 'flash', 'java', 'silverlight', 'quicktime', 'shockwave', 'vlc', 'media', 'widevine']) {
    assert.ok((VERBOTENE_PLUGIN_BEGRIFFE as readonly string[]).includes(b), b);
  }
  for (let i = 0; i < 5000; i++) {
    const p = pluginAus(hash32(`verboten-${i}`));
    for (const feld of [p.name, p.beschreibung, p.datei, p.mimeTyp, p.endung]) {
      const klein = feld.toLowerCase();
      for (const b of VERBOTENE_PLUGIN_BEGRIFFE) assert.ok(!klein.includes(b), `${b} in ${feld}`);
    }
  }
});

test('pluginAus ist deterministisch und je Seed verschieden', () => {
  const namen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const seed = hash32(`seed-${i}`);
    const a = pluginAus(seed);
    assert.deepEqual(pluginAus(seed), a);
    namen.add(a.name);
  }
  // 14 Konsonanten und 5 Vokale ueber 5 bis 7 Buchstaben je Wort, zwei
  // Woerter: Zusammenstoesse unter 1000 Seeds sind praktisch ausgeschlossen.
  assert.ok(namen.size >= 995, `nur ${namen.size} verschiedene Namen aus 1000 Seeds`);
  assert.notEqual(pluginAus(seedAus('t', 'a.example')).name, pluginAus(seedAus('t', 'b.example')).name);
  assert.notEqual(pluginAus(seedAus('t', 'a.example')).name, pluginAus(seedAus('u', 'a.example')).name);
});
