/**
 * `src/engine/abp.ts`: eine Zeile Filterliste → eine Regel.
 *
 * Der Parser ENTSCHEIDET NICHT, ob eine Regel umsetzbar ist (das tut
 * `dnr.ts`). Hier wird deshalb nur geprueft, ob er richtig ZERLEGT: welche
 * Zeilenart, welches Muster, welche Optionen. Ein `$removeparam` ist an
 * dieser Stelle eine gueltige Netzregel mit einer fremden Option, kein
 * Fehler; erst der Uebersetzer wirft sie weg.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseListe, parseZeile } from '../../src/engine/abp.ts';
import type { Kosmetikregel, Netzregel, Scriptletregel, Unbekannt } from '../../src/engine/abp.ts';

function netz(zeile: string): Netzregel {
  const regel = parseZeile(zeile);
  assert.ok(regel && regel.typ === 'netz', `${zeile} ist keine Netzregel`);
  return regel;
}

function kosmetik(zeile: string): Kosmetikregel {
  const regel = parseZeile(zeile);
  assert.ok(regel && regel.typ === 'kosmetik', `${zeile} ist keine Kosmetikregel`);
  return regel;
}

function scriptlet(zeile: string): Scriptletregel {
  const regel = parseZeile(zeile);
  assert.ok(regel && regel.typ === 'scriptlet', `${zeile} ist keine Scriptletregel`);
  return regel;
}

function unbekannt(zeile: string): Unbekannt {
  const regel = parseZeile(zeile);
  assert.ok(regel && regel.typ === 'unbekannt', `${zeile} ist nicht unbekannt`);
  return regel;
}

// ── Zeilenarten ────────────────────────────────────────────────────────────

test('Kommentare, Kopfzeilen und Leerzeilen sind keine Regeln', () => {
  assert.equal(parseZeile('! EasyList'), null);
  assert.equal(parseZeile('!'), null);
  assert.equal(parseZeile('[Adblock Plus 2.0]'), null);
  assert.equal(parseZeile(''), null);
  assert.equal(parseZeile('   '), null);
  assert.equal(parseZeile('\t\r'), null);
  assert.equal(parseZeile('# nur ein Kommentar'), null);
  assert.equal(parseZeile('#'), null);
});

test('eine Netzregel behaelt ihr Muster und ist keine Ausnahme', () => {
  const regel = netz('||werbung.example^');
  assert.equal(regel.muster, '||werbung.example^');
  assert.equal(regel.ausnahme, false);
  assert.equal(regel.regex, null);
  assert.deepEqual(regel.typen, []);
  assert.deepEqual(regel.fremdeOptionen, []);
});

test('`@@` macht aus derselben Zeile eine Ausnahme, ohne das Muster zu aendern', () => {
  const regel = netz('@@||werbung.example^');
  assert.equal(regel.ausnahme, true);
  assert.equal(regel.muster, '||werbung.example^');
});

test('Kosmetik `##`: Domainteil und Selektor werden getrennt', () => {
  const generisch = kosmetik('##.werbung');
  assert.deepEqual(generisch.domains, []);
  assert.equal(generisch.selektor, '.werbung');
  assert.equal(generisch.ausnahme, false);

  const spezifisch = kosmetik('shop.example,markt.example##.banner');
  assert.deepEqual(spezifisch.domains, ['shop.example', 'markt.example']);
  assert.equal(spezifisch.selektor, '.banner');
});

test('Kosmetik `#@#` ist eine Ausnahme, `~domain` eine Ausnahme im Domainteil', () => {
  const ausnahme = kosmetik('shop.example#@#.banner');
  assert.equal(ausnahme.ausnahme, true);
  assert.deepEqual(ausnahme.domains, ['shop.example']);

  const negiert = kosmetik('~shop.example##.banner');
  assert.equal(negiert.ausnahme, false);
  assert.deepEqual(negiert.domains, []);
  assert.deepEqual(negiert.ausgeschlosseneDomains, ['shop.example']);
});

test('Domains im Kosmetikteil werden klein geschrieben', () => {
  assert.deepEqual(kosmetik('SHOP.Example##.banner').domains, ['shop.example']);
});

test('Scriptlet `##+js(name, args)`: Name und Argumente, Leerraum faellt weg', () => {
  const regel = scriptlet('shop.example##+js(set-constant, window.canRunAds, true)');
  assert.equal(regel.name, 'set-constant');
  assert.deepEqual(regel.args, ['window.canRunAds', 'true']);
  assert.deepEqual(regel.domains, ['shop.example']);
  assert.equal(regel.ausnahme, false);
});

test('Scriptlet: `\\,` bleibt ein Komma, `.js` faellt vom Namen ab', () => {
  const regel = scriptlet('shop.example##+js(set-constant.js, a, b\\,c)');
  assert.equal(regel.name, 'set-constant');
  assert.deepEqual(regel.args, ['a', 'b,c']);
});

test('`#@#+js()` ohne Namen nimmt alle Scriptlets des Hosts zurueck', () => {
  const regel = scriptlet('shop.example#@#+js()');
  assert.equal(regel.ausnahme, true);
  assert.equal(regel.name, '');
  assert.deepEqual(regel.args, []);
});

// ── Optionen ───────────────────────────────────────────────────────────────

test('third-party und ~third-party setzen dasselbe Feld gegensaetzlich', () => {
  assert.equal(netz('||a.example^$third-party').drittanbieter, true);
  assert.equal(netz('||a.example^$~third-party').drittanbieter, false);
  assert.equal(netz('||a.example^$3p').drittanbieter, true);
  assert.equal(netz('||a.example^$1p').drittanbieter, false);
  assert.equal(netz('||a.example^$first-party').drittanbieter, false);
  assert.equal(netz('||a.example^').drittanbieter, null);
});

test('`domain=a|~b` trennt gewollte von ausgeschlossenen Seiten', () => {
  const regel = netz('||a.example^$domain=news.example|~intern.news.example|blog.example');
  assert.deepEqual(regel.domains, ['news.example', 'blog.example']);
  assert.deepEqual(regel.ausgeschlosseneDomains, ['intern.news.example']);
});

test('`from=` ist ein Zweitname von `domain=`', () => {
  assert.deepEqual(netz('||a.example^$from=news.example').domains, ['news.example']);
});

test('Ressourcentypen und ihre Kuerzel bilden auf denselben Namen ab', () => {
  assert.deepEqual(netz('||a.example^$xhr').typen, ['xmlhttprequest']);
  assert.deepEqual(netz('||a.example^$frame').typen, ['subdocument']);
  assert.deepEqual(netz('||a.example^$css').typen, ['stylesheet']);
  assert.deepEqual(netz('||a.example^$doc').typen, ['document']);
  assert.deepEqual(netz('||a.example^$beacon').typen, ['ping']);
  assert.deepEqual(netz('||a.example^$script,image,media,font,websocket,other').typen, [
    'script',
    'image',
    'media',
    'font',
    'websocket',
    'other',
  ]);
});

test('`~typ` landet in den ausgeschlossenen Typen, nicht in den gewollten', () => {
  const regel = netz('||a.example^$~script,~image');
  assert.deepEqual(regel.typen, []);
  assert.deepEqual(regel.ausgeschlosseneTypen, ['script', 'image']);
});

test('important und match-case werden als Merkmale gelesen', () => {
  assert.equal(netz('||a.example^$important').wichtig, true);
  assert.equal(netz('||a.example^').wichtig, false);
  assert.equal(netz('||a.example^$match-case').matchCase, true);
});

test('Kosmetikoptionen stehen getrennt von den fremden Optionen', () => {
  const regel = netz('@@||a.example^$generichide');
  assert.deepEqual(regel.kosmetikOptionen, ['generichide']);
  assert.deepEqual(regel.fremdeOptionen, []);
});

test('unbekannte Optionen kommen als fremde Optionen durch, nicht als Fehler', () => {
  assert.deepEqual(netz('||a.example^$removeparam=x').fremdeOptionen, ['removeparam']);
  assert.deepEqual(netz('||a.example^$hurz').fremdeOptionen, ['hurz']);
  assert.deepEqual(netz('||a.example^$csp=script-src none').fremdeOptionen, ['csp']);
  // Muster bleibt heil: die Option wird abgetrennt, nicht mitgelesen.
  assert.equal(netz('||a.example^$removeparam=x').muster, '||a.example^');
});

test('`_` und `noop` sind Platzhalter und bewirken nichts', () => {
  const regel = netz('||a.example^$_,noop');
  assert.deepEqual(regel.fremdeOptionen, []);
  assert.deepEqual(regel.typen, []);
});

// ── Sonderfaelle ───────────────────────────────────────────────────────────

test('ein regulaerer Ausdruck landet in `regex`, das Muster wird leer', () => {
  const regel = netz('/ads\\d+\\.js/');
  assert.equal(regel.regex, 'ads\\d+\\.js');
  assert.equal(regel.muster, '');
});

test('ein `$` am Ende eines Ausdrucks ist keine Optionsliste', () => {
  const regel = netz('/ads\\.js$/');
  assert.equal(regel.regex, 'ads\\.js$');
  assert.deepEqual(regel.fremdeOptionen, []);
});

test('eine Optionsliste ohne Muster bleibt eine Regel mit leerem Muster', () => {
  const regel = netz('$popup,domain=a.example');
  assert.equal(regel.muster, '');
  assert.deepEqual(regel.typen, ['popup']);
  assert.deepEqual(regel.domains, ['a.example']);
});

test('nur `||` oder `|` ist syntaktisch eine Netzregel; das Aussortieren macht dnr.ts', () => {
  assert.equal(netz('||').muster, '||');
  assert.equal(netz('|').muster, '|');
});

test('erweiterte Kosmetik, HTML-Filter und leerer Selektor sind unbekannt, mit Grund', () => {
  // `#?#` verwirft der Parser seit dem 08.09.2026 NICHT mehr; er liest die
  // Zeile als Kosmetikregel und merkt sich `prozedural: true`. Ob der Selektor
  // trotzdem reines CSS ist, entscheidet die Grammatik in `kosmetik.ts` —
  // gemessen waren 903 der 2.465 `#?#`-Zeilen genau das. Der Grund
  // `erweiterteKosmetik` faellt fuer sie jetzt dort, nicht hier;
  // `tests/engine/prozedural.test.ts` haelt das fest.
  assert.equal(unbekannt('shop.example#$#.a { color: red }').grund, 'erweiterteKosmetik');
  assert.equal(unbekannt('shop.example#%#//scriptlet("x")').grund, 'erweiterteKosmetik');
  assert.equal(unbekannt('shop.example##^script:has-text(ad)').grund, 'htmlFilter');
  assert.equal(unbekannt('shop.example##').grund, 'syntax');
  assert.equal(unbekannt('shop.example##+js(offen').grund, 'syntax');
});

test('ein Netzmuster mit `/` wird nicht faelschlich als Kosmetik gelesen', () => {
  const regel = netz('||a.example/x##y');
  assert.equal(regel.muster, '||a.example/x##y');
});

test('eine Entity-Domain (`tellows.*##`) bleibt Kosmetik', () => {
  const regel = kosmetik('tellows.*##.werbung');
  assert.deepEqual(regel.domains, ['tellows.*']);
});

test('parseListe ueberliest Kommentare und zaehlt nur Regeln', () => {
  const text = ['[Adblock Plus 2.0]', '! Kopf', '', '||a.example^', '##.werbung', 'b.example##+js(noeval)'].join('\n');
  const regeln = parseListe(text);
  assert.equal(regeln.length, 3);
  assert.deepEqual(
    regeln.map((r) => r.typ),
    ['netz', 'kosmetik', 'scriptlet'],
  );
});

test('ein Wagenruecklauf am Zeilenende stoert nicht', () => {
  const regel = netz('||a.example^\r');
  assert.equal(regel.muster, '||a.example^');
});
