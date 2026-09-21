/**
 * Jede AUSGELIEFERTE Regel gegen das DNR-Schema.
 *
 * Der Unterschied zu `dnr.test.ts`: Dort laeuft der Konverter mit
 * ausgedachten Zeilen, hier wird gelesen, was wirklich in `rules/*.json`
 * steht und was der Browser beim Laden der Erweiterung vorgesetzt bekommt.
 *
 * Warum das eine eigene Datei ist: Chrome lehnt ein Ruleset beim Laden
 * KOMPLETT ab, wenn eine einzige Regel nicht passt, und sagt es nur in einer
 * Konsolenzeile, die niemand sieht. Der Werbeblocker blockt dann nichts und
 * meldet nichts. Deshalb wird hier von Hand geprueft und nicht bloss
 * `pruefeRegelsatz()` aufgerufen: Ein Fehler in der Pruefung des Konverters
 * wuerde sich sonst selbst bescheinigen. `pruefeRegelsatz()` laeuft am Ende
 * trotzdem mit, als zweite Meinung.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DNR_RESSOURCEN } from '../../src/engine/dnr-typen.ts';
import type { DnrRegel } from '../../src/engine/dnr-typen.ts';
import { domainGueltig, pruefeRegelsatz } from '../../src/engine/dnr.ts';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Quelle = {
  id: string;
  name: string;
  budget: number;
  /** Listen, deren Regeln auch die Navigation aufhalten duerfen (Schadadressen). */
  blocktNavigation?: boolean;
};

const QUELLEN: Quelle[] = JSON.parse(readFileSync(join(WURZEL, 'listen', 'quellen.json'), 'utf8'));

/** Was Chrome als Aktion kennt; `upgradeScheme` erzeugt der Konverter nicht, verboten ist es nicht. */
const AKTIONEN = new Set(['block', 'allow', 'allowAllRequests', 'upgradeScheme', 'redirect']);
const RESSOURCEN = new Set<string>(DNR_RESSOURCEN);
const DOMAINFELDER = [
  'requestDomains',
  'excludedRequestDomains',
  'initiatorDomains',
  'excludedInitiatorDomains',
] as const;

const NUR_ASCII = /^[\x21-\x7e]+$/;
const REGEX_MAX = 200;

assert.ok(QUELLEN.length > 0, 'listen/quellen.json ist leer');

test('jede Liste aus quellen.json hat eine gebaute Regeldatei', () => {
  for (const quelle of QUELLEN) {
    assert.ok(
      existsSync(join(WURZEL, 'rules', `${quelle.id}.json`)),
      `rules/${quelle.id}.json fehlt. Zuerst: npm run listen:bauen`,
    );
  }
});

for (const quelle of QUELLEN) {
  const pfad = join(WURZEL, 'rules', `${quelle.id}.json`);
  if (!existsSync(pfad)) continue;
  const regeln: DnrRegel[] = JSON.parse(readFileSync(pfad, 'utf8'));

  test(`rules/${quelle.id}.json: Form der Datei und Budget ${quelle.budget}`, () => {
    assert.ok(Array.isArray(regeln), 'die Datei ist kein Array');
    assert.ok(regeln.length > 0, 'ein leeres Ruleset blockt nichts und sagt es nicht');
    assert.ok(
      regeln.length <= quelle.budget,
      `${regeln.length} Regeln bei Budget ${quelle.budget}`,
    );
  });

  test(`rules/${quelle.id}.json: IDs ganzzahlig, >= 1 und eindeutig`, () => {
    const gesehen = new Set<number>();
    for (const regel of regeln) {
      assert.ok(Number.isInteger(regel.id), `id ${String(regel.id)} ist nicht ganzzahlig`);
      assert.ok(regel.id >= 1, `id ${regel.id} ist kleiner als 1`);
      assert.ok(!gesehen.has(regel.id), `id ${regel.id} kommt zweimal vor`);
      gesehen.add(regel.id);
    }
    assert.equal(gesehen.size, regeln.length);
  });

  test(`rules/${quelle.id}.json: Prioritaet und Aktion`, () => {
    for (const regel of regeln) {
      assert.ok(
        Number.isInteger(regel.priority) && regel.priority >= 1,
        `Regel ${regel.id}: priority ${String(regel.priority)}`,
      );
      assert.ok(regel.action && AKTIONEN.has(regel.action.type), `Regel ${regel.id}: Aktion ${String(regel.action?.type)}`);
      // Eine Umleitung ohne Datei im Paket laedt nichts - fuer die Seite
      // sieht das aus wie ein Block, nur merkt es niemand.
      if (regel.action?.type === 'redirect') {
        const pfad = regel.action.redirect?.extensionPath;
        assert.ok(
          typeof pfad === 'string' && pfad.startsWith('/attrappen/'),
          `Regel ${regel.id}: redirect ohne extensionPath unter /attrappen/`,
        );
        assert.equal(regel.priority, 3, `Regel ${regel.id}: eine Attrappe muss jede Blockregel schlagen (Vorrang 3)`);
      }
    }
  });

  test(`rules/${quelle.id}.json: keine Bedingung, die alles trifft`, () => {
    for (const regel of regeln) {
      const b = regel.condition;
      assert.ok(b && typeof b === 'object' && !Array.isArray(b), `Regel ${regel.id}: keine Bedingung`);
      assert.ok(Object.keys(b).length > 0, `Regel ${regel.id}: leere Bedingung`);
      const grenztEin =
        Boolean(b.urlFilter) ||
        Boolean(b.regexFilter) ||
        Boolean(b.requestDomains?.length) ||
        Boolean(b.initiatorDomains?.length) ||
        Boolean(b.resourceTypes?.length && b.domainType);
      assert.ok(grenztEin, `Regel ${regel.id}: grenzt nichts ein, traefe jede Anfrage`);
      assert.ok(
        !(b.urlFilter !== undefined && b.regexFilter !== undefined),
        `Regel ${regel.id}: urlFilter und regexFilter zugleich`,
      );
    }
  });

  test(`rules/${quelle.id}.json: urlFilter nur ASCII`, () => {
    for (const regel of regeln) {
      const filter = regel.condition.urlFilter;
      if (filter === undefined) continue;
      assert.ok(filter.length > 0, `Regel ${regel.id}: leerer urlFilter`);
      assert.ok(NUR_ASCII.test(filter), `Regel ${regel.id}: urlFilter ausserhalb ASCII: ${filter}`);
      assert.ok(filter.length <= 500, `Regel ${regel.id}: urlFilter zu lang`);
    }
  });

  test(`rules/${quelle.id}.json: regexFilter RE2-tauglich und <= ${REGEX_MAX} Zeichen`, () => {
    for (const regel of regeln) {
      const regex = regel.condition.regexFilter;
      if (regex === undefined) continue;
      assert.ok(regex.length <= REGEX_MAX, `Regel ${regel.id}: regexFilter ${regex.length} Zeichen`);
      // RE2 kennt weder Lookaround noch Rueckverweise; Chrome lehnt die Regel ab.
      assert.ok(!regex.includes('(?='), `Regel ${regel.id}: Lookahead im regexFilter`);
      assert.ok(!regex.includes('(?!'), `Regel ${regel.id}: negativer Lookahead im regexFilter`);
      assert.ok(!regex.includes('(?<'), `Regel ${regel.id}: Lookbehind im regexFilter`);
      assert.ok(!/\\[1-9]/.test(regex), `Regel ${regel.id}: Rueckverweis im regexFilter`);
      assert.doesNotThrow(() => new RegExp(regex), `Regel ${regel.id}: regexFilter ist kein gueltiger Ausdruck`);
    }
  });

  test(`rules/${quelle.id}.json: Domainlisten klein geschrieben, ohne Schema und Pfad`, () => {
    for (const regel of regeln) {
      for (const feld of DOMAINFELDER) {
        const liste = regel.condition[feld];
        if (liste === undefined) continue;
        assert.ok(Array.isArray(liste) && liste.length > 0, `Regel ${regel.id}: ${feld} leer`);
        for (const domain of liste) {
          assert.equal(domain, domain.toLowerCase(), `Regel ${regel.id}: ${feld} gross geschrieben: ${domain}`);
          assert.ok(!domain.includes('://'), `Regel ${regel.id}: ${feld} mit Schema: ${domain}`);
          assert.ok(!domain.includes('/'), `Regel ${regel.id}: ${feld} mit Pfad: ${domain}`);
          assert.ok(!domain.includes('*'), `Regel ${regel.id}: ${feld} mit Platzhalter: ${domain}`);
          assert.ok(domain.length > 0 && domain.length <= 253, `Regel ${regel.id}: ${feld} Laenge: ${domain}`);
          assert.ok(NUR_ASCII.test(domain), `Regel ${regel.id}: ${feld} ausserhalb ASCII: ${domain}`);
          // Der Doppelpunkt: In `example.com:8080` ist er ein Port und
          // gehoert nicht hierher, in `[::1]` gehoert er zur Adresse. Statt
          // das ein zweites Mal zu formulieren, fragt der Waechter dieselbe
          // Funktion wie die Engine - zwei Auslegungen desselben Begriffs
          // waeren eine zu viel, und die falsche bliebe beim naechsten Umbau
          // stehen.
          assert.ok(
            domainGueltig(domain),
            `Regel ${regel.id}: ${feld} ist kein gueltiger Host: ${domain}`,
          );
        }
      }
    }
  });

  test(`rules/${quelle.id}.json: Ressourcentypen bekannt, allowAllRequests nur auf Rahmen`, () => {
    for (const regel of regeln) {
      const b = regel.condition;
      assert.ok(
        !(b.resourceTypes !== undefined && b.excludedResourceTypes !== undefined),
        `Regel ${regel.id}: resourceTypes und excludedResourceTypes zugleich`,
      );
      for (const feld of ['resourceTypes', 'excludedResourceTypes'] as const) {
        const liste = b[feld];
        if (liste === undefined) continue;
        assert.ok(liste.length > 0, `Regel ${regel.id}: ${feld} leer`);
        for (const typ of liste) assert.ok(RESSOURCEN.has(typ), `Regel ${regel.id}: unbekannter Typ ${typ}`);
      }
      if (regel.action.type === 'allowAllRequests') {
        const typen = b.resourceTypes ?? [];
        assert.ok(typen.length > 0, `Regel ${regel.id}: allowAllRequests ohne resourceTypes`);
        for (const typ of typen) {
          assert.ok(
            typ === 'main_frame' || typ === 'sub_frame',
            `Regel ${regel.id}: allowAllRequests mit ${typ}`,
          );
        }
      }
      if (b.domainType !== undefined) {
        assert.ok(
          b.domainType === 'firstParty' || b.domainType === 'thirdParty',
          `Regel ${regel.id}: domainType ${String(b.domainType)}`,
        );
      }
    }
  });

  test(`rules/${quelle.id}.json: keine Blockregel ohne Typ trifft die Navigation`, () => {
    // Falle 4 aus dnr.ts: `||host^` blockt in ABP keine Seite, in DNR schon.
    //
    // Genau eine Art Liste darf das Gegenteil wollen: eine, die Schadadressen
    // fuehrt. Dort ist der Klick auf den Link der gefaehrliche Fall, und eine
    // Regel, die nur eingebettete Ressourcen aufhaelt, laesst ihn durch. Diese
    // Listen tragen `blocktNavigation: true` in `listen/quellen.json` - im
    // Datensatz, nicht in einer Namensliste hier drin, damit die Entscheidung
    // neben der Quelle steht und nicht in einem Test versteckt ist.
    if (quelle.blocktNavigation) {
      // Dann aber richtig, und zwar in der Form, die WIRKT: Chrome nimmt
      // `main_frame` von sich aus aus, sobald `resourceTypes` fehlt. Das
      // blosse Weglassen von `excludedResourceTypes` genuegt also nicht - die
      // Typen muessen aufgezaehlt sein. Gemessen an einer echten
      // Malware-Adresse: ohne Aufzaehlung fiel sie als `fetch`, lud aber als
      // Seitenaufruf.
      const bloecke = regeln.filter((r) => r.action.type === 'block');
      const trifftNavigation = bloecke.filter((r) => r.condition.resourceTypes?.includes('main_frame'));
      assert.ok(
        trifftNavigation.length / bloecke.length > 0.5,
        `${quelle.id} traegt blocktNavigation, aber nur ${trifftNavigation.length} von ${bloecke.length} ` +
          `Blockregeln zaehlen main_frame in resourceTypes auf. Entweder ist das Kennzeichen falsch, ` +
          `oder die Liste hat ihr Format geaendert.`,
      );
      // Die uebrigen - Zeilen ohne `$all` - halten sich weiter an die Regel.
      for (const regel of bloecke) {
        if (regel.condition.resourceTypes !== undefined) continue;
        assert.ok(
          regel.condition.excludedResourceTypes?.includes('main_frame'),
          `Regel ${regel.id}: ohne \`$all\` und ohne Ausschluss von main_frame`,
        );
      }
      return;
    }
    for (const regel of regeln) {
      if (regel.action.type !== 'block') continue;
      const b = regel.condition;
      if (b.resourceTypes !== undefined) {
        assert.ok(
          !b.resourceTypes.includes('main_frame'),
          `Regel ${regel.id}: blockt main_frame, damit ist die Seite unerreichbar`,
        );
        continue;
      }
      assert.ok(
        b.excludedResourceTypes?.includes('main_frame'),
        `Regel ${regel.id}: Blockregel ohne Typ ohne excludedResourceTypes main_frame`,
      );
    }
  });

  test(`rules/${quelle.id}.json: zweite Meinung von pruefeRegelsatz()`, () => {
    const probleme = pruefeRegelsatz(regeln, quelle.budget);
    assert.deepEqual(probleme, [], probleme.slice(0, 5).join('; '));
  });
}

test('das Regex-Kontingent von Chrome (1000 je Erweiterung) reicht fuer alle Listen zusammen', () => {
  let regex = 0;
  for (const quelle of QUELLEN) {
    const pfad = join(WURZEL, 'rules', `${quelle.id}.json`);
    if (!existsSync(pfad)) continue;
    const regeln: DnrRegel[] = JSON.parse(readFileSync(pfad, 'utf8'));
    regex += regeln.filter((r) => r.condition.regexFilter !== undefined).length;
  }
  assert.ok(regex <= 1000, `${regex} Regex-Regeln ueber alle Listen`);
});
