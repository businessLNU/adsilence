/**
 * `src/engine/kosmetik.ts`: Selektoren fuers Stylesheet.
 *
 * Der teure Fehler steht am Ende dieser Datei: Die generischen Selektoren
 * landen zu je 500 in EINER CSS-Regel. Ein einziger ungueltiger Selektor
 * darin, und der Browser wirft die ganze Gruppe weg, ohne Meldung. Deshalb
 * wird `kosmetik/generisch.css` hier als Datei gelesen und Gruppe fuer
 * Gruppe geprueft, nicht bloss die Funktion, die sie erzeugt hat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseListe } from '../../src/engine/abp.ts';
import { alsStylesheet, hostGueltig, selektorGueltig, zuKosmetik } from '../../src/engine/kosmetik.ts';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function buendel(...zeilen: string[]): ReturnType<typeof zuKosmetik> {
  return zuKosmetik(parseListe(zeilen.join('\n')));
}

// ── generisch, spezifisch, Ausnahmen ───────────────────────────────────────

test('ohne Domain ist ein Selektor generisch, mit Domain spezifisch', () => {
  const k = buendel('##.werbung', 'shop.example##.banner');
  assert.deepEqual(k.generisch, ['.werbung']);
  assert.deepEqual(k.spezifisch, { 'shop.example': ['.banner'] });
  assert.deepEqual(k.ausnahmen, {});
});

test('mehrere Domains bekommen denselben Selektor je einmal', () => {
  const k = buendel('shop.example,markt.example##.box', 'shop.example##.box');
  assert.deepEqual(k.spezifisch, { 'markt.example': ['.box'], 'shop.example': ['.box'] });
});

test('`~domain##sel` ist generisch mit einer Ausnahme fuer diese Domain', () => {
  const k = buendel('~shop.example##.banner');
  assert.deepEqual(k.generisch, ['.banner']);
  assert.deepEqual(k.ausnahmen, { 'shop.example': ['.banner'] });
});

test('`domain,~sub.domain##sel` gilt auf der Domain, nicht auf der Unterdomain', () => {
  const k = buendel('shop.example,~intern.shop.example##.box');
  assert.deepEqual(k.spezifisch, { 'shop.example': ['.box'] });
  assert.deepEqual(k.ausnahmen, { 'intern.shop.example': ['.box'] });
});

test('`domain#@#sel` nimmt den Selektor nur auf dieser Domain zurueck', () => {
  const k = buendel('##.banner', 'shop.example#@#.banner');
  assert.deepEqual(k.generisch, ['.banner']);
  assert.deepEqual(k.ausnahmen, { 'shop.example': ['.banner'] });
});

test('`#@#sel` ohne Domain streicht den Selektor aus generisch', () => {
  const k = buendel('##.banner', '##.box', '#@#.banner');
  assert.deepEqual(k.generisch, ['.box']);
});

test('eine ungueltige Domain in der Negation macht die Regel unbrauchbar', () => {
  const verworfen: Record<string, number> = {};
  const k = zuKosmetik(parseListe('~shop.*##.banner'), verworfen);
  assert.deepEqual(k.generisch, []);
  assert.equal(verworfen.domainUngueltig, 1);
});

test('hostGueltig laesst nur echte Hostnamen durch', () => {
  assert.equal(hostGueltig('shop.example'), true);
  assert.equal(hostGueltig('a.b.c.example'), true);
  assert.equal(hostGueltig('shop.*'), false);
  assert.equal(hostGueltig('SHOP.example'), false);
  assert.equal(hostGueltig('shop.example/pfad'), false);
});

// ── prozedurale Selektoren fallen weg ──────────────────────────────────────

test('prozedurale Selektoren kann CSS nicht, sie werden verworfen und gezaehlt', () => {
  const verworfen: Record<string, number> = {};
  const k = zuKosmetik(
    parseListe(
      [
        'shop.example##.a:has-text(Werbung)',
        'shop.example##.b:matches-css(display: none)',
        'shop.example##:xpath(//div)',
        'shop.example##.c:upward(2)',
        'shop.example##.d:style(display: none)',
        'shop.example##.e:-abp-has(.x)',
        'shop.example##.f:watch-attr(class)',
        'shop.example##.g:remove()',
      ].join('\n'),
    ),
    verworfen,
  );
  assert.deepEqual(k.spezifisch, {});
  assert.equal(verworfen.selektorUngueltig, 8);
});

test('selektorGueltig: was durchkommt und was nicht', () => {
  for (const gut of [
    '.werbung',
    '#ad-container',
    'div[id^="ad-"]',
    '.a:not(.b)',
    '.a:has(.b)',
    '.a:nth-child(2)',
    'div > .a + .b ~ .c',
    '.a, .b',
    '.h-\\[250px\\]',
    '[aria-label="Anzeige"]',
  ]) {
    assert.equal(selektorGueltig(gut), true, `${gut} sollte gueltig sein`);
  }
  for (const schlecht of [
    '',
    '.5star',
    '#1',
    '.a::before',
    '.a:has-text(x)',
    '.a[unvollstaendig',
    'div]',
    '.a(',
    '.a,,.b',
    '.a,',
    '.a\\',
    '[a="offen]',
  ]) {
    assert.equal(selektorGueltig(schlecht), false, `${schlecht} sollte ungueltig sein`);
  }
});

// ── Stylesheet-Form ────────────────────────────────────────────────────────

test('alsStylesheet gruppiert und haengt an jede Gruppe die Deklaration', () => {
  const css = alsStylesheet(['.a', '.b', '.c'], 2);
  const gruppen = css.split('\n').filter((z) => z.endsWith('{display:none!important}'));
  assert.equal(gruppen.length, 2);
  assert.ok(css.includes('.a,\n.b{display:none!important}'));
  assert.ok(css.endsWith('.c{display:none!important}'));
  assert.equal(alsStylesheet([], 500), '');
});

// ── die ausgelieferte Datei ────────────────────────────────────────────────

const cssPfad = join(WURZEL, 'kosmetik', 'generisch.css');

test('kosmetik/generisch.css ist gebaut', () => {
  assert.ok(existsSync(cssPfad), 'kosmetik/generisch.css fehlt. Zuerst: npm run listen:bauen');
});

if (existsSync(cssPfad)) {
  const css = readFileSync(cssPfad, 'utf8');
  // Eine Gruppe endet immer mit der Deklaration; davor stehen die Selektoren.
  const gruppen = css
    .split('{display:none!important}')
    .map((teil) => teil.trim())
    .filter((teil) => teil !== '');

  test('kosmetik/generisch.css: jede Gruppe endet auf {display:none!important}', () => {
    assert.ok(gruppen.length > 0, 'keine einzige Gruppe in der Datei');
    const anzahlDeklarationen = css.split('{display:none!important}').length - 1;
    assert.equal(anzahlDeklarationen, gruppen.length);
    // Nichts steht hinter der letzten Deklaration ausser dem Zeilenende.
    assert.equal(css.trimEnd().endsWith('{display:none!important}'), true);
    // Und nichts anderes wird deklariert: kein zweiter Block, keine Regel
    // mit anderer Wirkung, die sich hier eingeschlichen haette.
    assert.equal(css.split('{').length - 1, anzahlDeklarationen, 'eine geschweifte Klammer ohne unsere Deklaration');
  });

  test('kosmetik/generisch.css: jede Gruppe enthaelt nur gueltige Selektoren', () => {
    let selektoren = 0;
    for (let i = 0; i < gruppen.length; i += 1) {
      // Innerhalb einer Gruppe trennen Kommas am Zeilenende die Selektoren;
      // ein Komma INNERHALB von `:not(...)` steht nie am Zeilenende.
      const teile = gruppen[i].split(',\n');
      assert.ok(teile.length <= 500, `Gruppe ${i + 1}: ${teile.length} Selektoren, hoechstens 500 erlaubt`);
      for (const roh of teile) {
        const selektor = roh.trim();
        selektoren += 1;
        assert.ok(
          selektorGueltig(selektor),
          `Gruppe ${i + 1}: ungueltiger Selektor reisst 500 andere mit: ${JSON.stringify(selektor)}`,
        );
      }
    }
    assert.ok(selektoren > 1000, `nur ${selektoren} generische Selektoren, das ist zu wenig fuer eine gebaute Liste`);
  });

  test('kosmetik/generisch.css: keine Steuerzeichen und keine `@`-Regel', () => {
    assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(css), 'Steuerzeichen in der Datei');
    assert.ok(!css.includes('@import'), '@import wuerde eine Adresse nachladen');
    assert.ok(!css.includes('/*'), 'ein Kommentar hat in der gebauten Datei nichts zu suchen');
  });
}
