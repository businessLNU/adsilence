/**
 * `src/engine/dnr.ts`: Netzregeln → declarativeNetRequest.
 *
 * Geprueft wird beides: was durchkommt (Muster, Prioritaeten, Bedingungen,
 * IDs, Budget) und was mit welchem GRUND liegen bleibt. Der Grund ist kein
 * Beiwerk: Er steht im Build-Bericht und in der Fehlerzeile der
 * Optionsseite. Eine Regel, die still verschwindet, ist der Fall, den diese
 * Datei verhindern soll.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseListe, parseZeile } from '../../src/engine/abp.ts';
import type { Netzregel, Regel } from '../../src/engine/abp.ts';
import { REGEX_MAX_LAENGE, regexTauglich, uebersetzeNetzregel, zuDnr } from '../../src/engine/dnr.ts';
import type { DnrRegel } from '../../src/engine/dnr-typen.ts';

function netzregel(zeile: string): Netzregel {
  const regel = parseZeile(zeile);
  assert.ok(regel && regel.typ === 'netz', `${zeile} ist keine Netzregel`);
  return regel;
}

/** Die uebersetzte Regel ohne ID, oder Fehlschlag mit Meldung. */
function ok(zeile: string): Omit<DnrRegel, 'id'> {
  const ergebnis = uebersetzeNetzregel(netzregel(zeile));
  assert.ok(ergebnis.ok, `${zeile} wurde verworfen: ${JSON.stringify(ergebnis)}`);
  return ergebnis.regel;
}

/** Der Verwerfungsgrund, oder Fehlschlag, wenn die Regel doch durchkam. */
function grundVon(zeile: string): string {
  const ergebnis = uebersetzeNetzregel(netzregel(zeile));
  assert.ok(!ergebnis.ok, `${zeile} kam durch, erwartet war ein Grund`);
  return ergebnis.verwerfung.option ?? ergebnis.verwerfung.grund;
}

function regeln(...zeilen: string[]): Regel[] {
  return parseListe(zeilen.join('\n'));
}

// ── Muster ─────────────────────────────────────────────────────────────────

test('`||host^` wird zu requestDomains, nicht zu einem Mustervergleich', () => {
  const regel = ok('||werbung.example^');
  assert.deepEqual(regel.condition.requestDomains, ['werbung.example']);
  assert.equal(regel.condition.urlFilter, undefined);
  // Ohne Typ darf eine Blockregel nie die Navigation selbst treffen.
  assert.deepEqual(regel.condition.excludedResourceTypes, ['main_frame']);
});

test('`||host` ohne `^` ist derselbe Fall', () => {
  assert.deepEqual(ok('||werbung.example').condition.requestDomains, ['werbung.example']);
});

test('`|anfang`, `ende|`, `*` und `^` bleiben als urlFilter erhalten', () => {
  assert.equal(ok('|http://a.example/x').condition.urlFilter, '|http://a.example/x');
  assert.equal(ok('/pfad/ende|').condition.urlFilter, '/pfad/ende|');
  assert.equal(ok('/banner*.gif').condition.urlFilter, '/banner*.gif');
  assert.equal(ok('/anzeige^').condition.urlFilter, '/anzeige^');
});

test('Klartext ohne Anker wird unveraendert zum urlFilter und ist nie gross/klein-genau', () => {
  const regel = ok('werbeklick');
  assert.equal(regel.condition.urlFilter, 'werbeklick');
  assert.equal(regel.condition.isUrlFilterCaseSensitive, false);
});

test('randstaendige und mehrfache Sternchen sagen nichts und fallen weg', () => {
  assert.equal(ok('**/banner**.gif*').condition.urlFilter, '/banner*.gif');
});

test('`|` mitten im Muster kennt DNR nicht', () => {
  assert.equal(grundVon('||a|b.example^'), 'sonderzeichen');
});

test('ein Muster ausserhalb ASCII wuerde das ganze Ruleset unladbar machen', () => {
  assert.equal(grundVon('||müller.example^'), 'nichtAscii');
});

test('ein Muster ueber 500 Zeichen faellt weg', () => {
  assert.equal(grundVon(`/${'a'.repeat(520)}`), 'zuLang');
});

// ── Prioritaeten (erweiterung.md N8) ───────────────────────────────────────

test('block 1, $important 2, @@ allow 3, @@$document allowAllRequests 4', () => {
  const block = ok('||a.example^');
  assert.equal(block.priority, 1);
  assert.equal(block.action.type, 'block');

  const wichtig = ok('||a.example^$important');
  assert.equal(wichtig.priority, 2);
  assert.equal(wichtig.action.type, 'block');

  const erlaubt = ok('@@||a.example^');
  assert.equal(erlaubt.priority, 3);
  assert.equal(erlaubt.action.type, 'allow');

  const seite = ok('@@||a.example^$document');
  assert.equal(seite.action.type, 'allowAllRequests');
  assert.deepEqual(seite.condition.resourceTypes, ['main_frame', 'sub_frame']);
});

test('allowAllRequests traegt IMMER nur main_frame/sub_frame, egal was die Zeile nennt', () => {
  const regel = ok('@@||a.example^$document,script,image');
  assert.equal(regel.action.type, 'allowAllRequests');
  assert.deepEqual(regel.condition.resourceTypes, ['main_frame', 'sub_frame']);
});

// ── Bedingungen ────────────────────────────────────────────────────────────

test('`domain=` wird zu initiatorDomains, `~domain` zu excludedInitiatorDomains', () => {
  const regel = ok('||a.example^$domain=news.example|~intern.news.example');
  assert.deepEqual(regel.condition.initiatorDomains, ['news.example']);
  assert.deepEqual(regel.condition.excludedInitiatorDomains, ['intern.news.example']);
});

test('eine unbrauchbare NEGATIVE Domain macht die Regel ungueltig', () => {
  // Ohne die Negation griffe die Regel dort, wo sie ausdruecklich nicht soll.
  assert.equal(grundVon('||a.example^$domain=~wayfair.*'), 'domainUngueltig');
});

test('eine unbrauchbare POSITIVE Domain wird uebergangen, solange eine gute bleibt', () => {
  const regel = ok('||a.example^$domain=wayfair.*|news.example');
  assert.deepEqual(regel.condition.initiatorDomains, ['news.example']);
});

test('bleibt keine brauchbare positive Domain, faellt die Regel weg', () => {
  assert.equal(grundVon('||a.example^$domain=wayfair.*'), 'domainUngueltig');
});

test('third-party wird zu domainType', () => {
  assert.equal(ok('||a.example^$third-party').condition.domainType, 'thirdParty');
  assert.equal(ok('||a.example^$~third-party').condition.domainType, 'firstParty');
  assert.equal(ok('||a.example^').condition.domainType, undefined);
});

test('Ressourcentypen werden auf die DNR-Namen abgebildet', () => {
  assert.deepEqual(ok('||a.example^$script').condition.resourceTypes, ['script']);
  assert.deepEqual(ok('||a.example^$frame').condition.resourceTypes, ['sub_frame']);
  assert.deepEqual(ok('||a.example^$xhr').condition.resourceTypes, ['xmlhttprequest']);
  assert.deepEqual(ok('||a.example^$css').condition.resourceTypes, ['stylesheet']);
});

test('nur negierte Typen werden zu excludedResourceTypes, main_frame kommt dazu', () => {
  const regel = ok('||a.example^$~script');
  assert.equal(regel.condition.resourceTypes, undefined);
  assert.deepEqual(regel.condition.excludedResourceTypes, ['main_frame', 'script']);
});

test('sind alle genannten Typen zugleich negiert, bleibt nichts zu blocken', () => {
  assert.equal(grundVon('||a.example^$script,~script'), 'typenLeer');
});

test('eine Regel, die nichts eingrenzt, faellt weg', () => {
  assert.equal(grundVon('$script'), 'leereBedingung');
});

test('Typen PLUS domainType grenzen genug ein (EasyPrivacys Absicht)', () => {
  const regel = ok('$ping,third-party');
  assert.deepEqual(regel.condition.resourceTypes, ['ping']);
  assert.equal(regel.condition.domainType, 'thirdParty');
});

// ── Regulaere Ausdruecke: nur RE2-tauglich ─────────────────────────────────

test('ein einfacher Ausdruck wird zu regexFilter', () => {
  const regel = ok('/ads[0-9]+\\.js/');
  assert.equal(regel.condition.regexFilter, 'ads[0-9]+\\.js');
  assert.equal(regel.condition.urlFilter, undefined);
});

test('Lookahead, Lookbehind und Rueckverweise kennt RE2 nicht', () => {
  assert.equal(grundVon('/(?=werbung)x/'), 'regexNichtRe2');
  assert.equal(grundVon('/(?!werbung)x/'), 'regexNichtRe2');
  assert.equal(grundVon('/(?<=werbung)x/'), 'regexNichtRe2');
  assert.equal(grundVon('/(?<!werbung)x/'), 'regexNichtRe2');
  assert.equal(grundVon('/(a)\\1/'), 'regexNichtRe2');
  assert.equal(regexTauglich('ads[0-9]+'), true);
  assert.equal(regexTauglich('(?=x)'), false);
  assert.equal(regexTauglich('(?>x)'), false);
  assert.equal(regexTauglich('[unvollstaendig'), false);
});

test(`ein Ausdruck ueber ${REGEX_MAX_LAENGE} Zeichen faellt weg`, () => {
  assert.equal(grundVon(`/${'a'.repeat(REGEX_MAX_LAENGE + 1)}/`), 'regexZuLang');
});

test('das Regex-Kontingent wird eingehalten und gezaehlt', () => {
  const zeilen = ['/ad1x/', '/ad2x/', '/ad3x/'];
  const ergebnis = zuDnr(regeln(...zeilen), { startId: 1, budget: 100, regexBudget: 2 });
  assert.equal(ergebnis.rules.length, 2);
  assert.equal(ergebnis.verworfen.regexBudget, 1);
});

// ── Verwerfungsgruende mit Zaehlung ────────────────────────────────────────

test('Optionen, die DNR nicht ausdruecken kann, zaehlen unter ihrem eigenen Namen', () => {
  assert.equal(grundVon('||a.example^$removeparam=x'), 'removeparam');
  assert.equal(grundVon('||a.example^$csp=script-src none'), 'csp');
  // `redirect-rule` bleibt ungedeckt: Es heisst „falls eine ANDERE Regel
  // blockt" - eine Bedingung, die DNR nicht kennt.
  assert.equal(grundVon('||a.example^$redirect-rule=noop.js'), 'redirect-rule');
  // Ein `$redirect` auf eine Attrappe, die es nicht gibt, bleibt verworfen -
  // und zaehlt unter dem NAMEN der fehlenden Attrappe. So steht im Bericht,
  // welche Datei sich als naechste zu bauen lohnt, statt nur „irgendeine".
  assert.equal(grundVon('||a.example^$redirect=gibtesnicht.js'), 'gibtesnicht.js');
  assert.equal(grundVon('||a.example^$replace=/a/b/'), 'replace');
  assert.equal(grundVon('||a.example^$denyallow=b.example'), 'denyallow');
  assert.equal(grundVon('||a.example^$badfilter'), 'badfilter');
  assert.equal(grundVon('||a.example^$match-case'), 'match-case');
  assert.equal(grundVon('||a.example^$header=x:y'), 'header');
});

test('`$popup` und `$document` als BLOCK wuerden ganze Seiten sperren', () => {
  assert.equal(grundVon('||a.example^$popup'), 'popup');
  assert.equal(grundVon('||a.example^$document'), 'document');
  // Als Ausnahme sind beide sinnvoll und kommen durch.
  assert.equal(ok('@@||a.example^$document').action.type, 'allowAllRequests');
});

test('eine reine Kosmetikausnahme wird keine Netzausnahme', () => {
  // `@@||a.com^$generichide` schaltet Selektoren ab, nicht das Blocken.
  assert.equal(grundVon('@@||a.example^$generichide'), 'generichide');
  assert.equal(grundVon('@@||a.example^$elemhide'), 'elemhide');
});

test('die Zaehlung im Ergebnis nennt jeden Grund mit seiner Anzahl', () => {
  const ergebnis = zuDnr(
    regeln('||a.example^$removeparam=x', '||b.example^$removeparam=y', '||c.example^$popup', '||d.example^'),
    { startId: 1, budget: 100 },
  );
  assert.deepEqual(ergebnis.verworfen, { removeparam: 2, popup: 1 });
  assert.equal(ergebnis.rules.length, 1);
});

test('eine identische Regel zweimal kostet Budget und zaehlt als doppelt', () => {
  const ergebnis = zuDnr(regeln('||a.example^', '||a.example^'), { startId: 1, budget: 100 });
  assert.equal(ergebnis.rules.length, 1);
  assert.equal(ergebnis.verworfen.doppelt, 1);
});

// ── IDs, Reihenfolge, Budget ───────────────────────────────────────────────

test('IDs sind eindeutig, fortlaufend und beginnen bei startId', () => {
  const ergebnis = zuDnr(regeln('||a.example^', '||b.example/x', '@@||c.example^', '/adx[0-9]/'), {
    startId: 100000,
    budget: 100,
  });
  const ids = ergebnis.rules.map((r) => r.id);
  assert.equal(ids[0], 100000);
  assert.deepEqual(ids, [100000, 100001, 100002, 100003]);
  assert.equal(new Set(ids).size, ids.length);
});

test('Ausnahmen kommen vor Blocks, reine Hosts vor Pfadmustern', () => {
  const ergebnis = zuDnr(regeln('||b.example/pfad', '||a.example^', '@@||c.example^'), { startId: 1, budget: 100 });
  assert.deepEqual(
    ergebnis.rules.map((r) => r.action.type),
    ['allow', 'block', 'block'],
  );
  assert.equal(ergebnis.rules[1].condition.requestDomains?.[0], 'a.example');
  assert.equal(ergebnis.rules[2].condition.urlFilter, '||b.example/pfad');
});

/*
 * `einzelnBis: 0` in den Zusammenleg-Tests: Seit `EINZELN_BIS` werden Gruppen
 * bis zehn Hosts EINZELN ausgegeben, damit die Trefferliste im Popup einen
 * Namen zeigen kann. Drei Hosts fielen damit unter die Grenze, und diese
 * Tests pruefen das Zusammenlegen selbst — also schalten sie es fuer sich
 * ausdruecklich scharf, statt mit elf Hosts zu rechnen.
 */
test('Regeln, die sich nur im Host unterscheiden, werden zu EINER Regel', () => {
  const ergebnis = zuDnr(regeln('||a.example^', '||b.example^', '||c.example^'), { startId: 1, budget: 100, einzelnBis: 0 });
  assert.equal(ergebnis.rules.length, 1);
  assert.deepEqual(ergebnis.rules[0].condition.requestDomains, ['a.example', 'b.example', 'c.example']);
  // Die Zusammenlegung darf keine Listenzeile verschlucken.
  assert.equal(ergebnis.quellregeln, 3);
});

test('hostsJeRegel teilt die zusammengelegten Regeln auf', () => {
  const ergebnis = zuDnr(regeln('||a.example^', '||b.example^', '||c.example^'), {
    startId: 1,
    budget: 100,
    hostsJeRegel: 2,
    einzelnBis: 0,
  });
  assert.equal(ergebnis.rules.length, 2);
  assert.deepEqual(ergebnis.rules[0].condition.requestDomains, ['a.example', 'b.example']);
  assert.deepEqual(ergebnis.rules[1].condition.requestDomains, ['c.example']);
});

/**
 * Die Trefferliste im Popup kann nur einen Namen zeigen, wenn die Regel genau
 * EINEN Host traegt. Chrome nennt zum Treffer nur die Regelnummer; bei einer
 * Regel mit dreissig Hosts steht dann „eine von mehreren Domains".
 *
 * GEMESSEN am 08.09.2026: 349 solcher Sammelregeln im Paket, und in einer
 * Trefferliste mit sechs Zeilen stand der Satz dreimal. Bis zehn Hosts wird
 * deshalb einzeln ausgegeben — das kostet 335 Regeln von ueber 300.000
 * freien und gibt 164 von 349 Regeln ihren Namen zurueck.
 */
test('bis EINZELN_BIS Hosts bleibt jede Regel fuer sich, darueber wird gebuendelt', () => {
  const klein = zuDnr(regeln('||a.example^', '||b.example^', '||c.example^'), { startId: 1, budget: 100 });
  assert.equal(klein.rules.length, 3, 'drei Hosts liegen unter der Grenze und muessen einzeln bleiben');
  assert.deepEqual(
    klein.rules.map((r) => r.condition.requestDomains),
    [['a.example'], ['b.example'], ['c.example']],
  );
  // Die Zeilen zaehlen weiter einzeln — nichts geht beim Aufspalten verloren.
  assert.equal(klein.quellregeln, 3);

  const viele = Array.from({ length: 11 }, (_, i) => `||h${i}.example^`);
  const gross = zuDnr(regeln(...viele), { startId: 1, budget: 100 });
  assert.equal(gross.rules.length, 1, 'elf Hosts liegen ueber der Grenze und werden zu einer Regel');
  assert.equal(gross.rules[0].condition.requestDomains?.length, 11);

  // Die Grenze ist eine Option, kein Naturgesetz — wer sie auf null stellt,
  // bekommt das alte Verhalten.
  const aus = zuDnr(regeln('||a.example^', '||b.example^'), { startId: 1, budget: 100, einzelnBis: 0 });
  assert.equal(aus.rules.length, 1);
});

test('das Budget wird eingehalten; was nicht mehr passt, zaehlt als budget', () => {
  const ergebnis = zuDnr(regeln('@@||d.example^', '||a.example/x', '||b.example/y', '||c.example/z'), {
    startId: 1,
    budget: 2,
  });
  assert.equal(ergebnis.rules.length, 2);
  assert.equal(ergebnis.verworfen.budget, 2);
  // Zuerst die Ausnahme: sie verhindert kaputte Seiten.
  assert.equal(ergebnis.rules[0].action.type, 'allow');
});

test('eine zusammengelegte Regel zaehlt alle ihre Zeilen aufs Budget', () => {
  const ergebnis = zuDnr(regeln('||a.example^', '||b.example^', '||c.example/x'), {
    startId: 1,
    budget: 1,
    hostsJeRegel: 1,
  });
  assert.equal(ergebnis.rules.length, 1);
  assert.equal(ergebnis.verworfen.budget, 2);
});

test('die Klassen im Ergebnis sagen, woraus der Regelsatz besteht', () => {
  const ergebnis = zuDnr(regeln('@@||d.example^', '||a.example^', '||b.example^$script', '||c.example/x'), {
    startId: 1,
    budget: 100,
  });
  assert.deepEqual(ergebnis.klassen, { 1: 1, 2: 1, 3: 1, 4: 1 });
});
