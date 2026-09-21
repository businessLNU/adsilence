/**
 * Schicht 1 von „Fingerabdruck verwischen": das Netz.
 *
 * Die verbreiteten Fingerprint-CDNs stehen in EasyPrivacy und Peter Lowes
 * Liste, beide ab Werk an. Es gibt dafuer ABSICHTLICH keine eigene Regel in
 * `listen/tarnung.txt`: Dort kommt nur hinein, was an einer echten Seite
 * gemessen wurde, und fuer diese Hosts hat die Messung laengst jemand anderes
 * gemacht. Was fehlt, ist der Nachweis, dass es so BLEIBT. Faellt ein Host
 * bei einer Listenaktualisierung heraus, meldet es niemand; der Schutz waere
 * dann auf das Rauschen allein angewiesen, und das steht nirgends.
 *
 * Deshalb prueft dieser Test die gebauten Regeln (`rules/<id>.json` der
 * Listen mit `standard: true` in `listen/quellen.json`), nicht die Quellen.
 *
 * ── Die Regelform, gemessen am 05.09.2026 ─────────────────────────────────
 * Die Hosts stehen NICHT als `urlFilter`, sondern in `requestDomains`-Listen
 * mit je 1000 Eintraegen (die Engine buendelt Hostregeln). Daneben gibt es
 * `allow`-Regeln fuer openfpcdn.io (`botd/v1`, `fingerprintjs/v3/iife.min.js`),
 * die ueber `initiatorDomains` auf einzelne Seiten begrenzt sind. Ein Test,
 * der nur nach `urlFilter` greift, faende nichts und waere gruen, ohne etwas
 * zu beweisen. Und ein Test, der nur die Form prueft, uebersaehe eine
 * `allow`-Regel, die alles wieder aufmacht. Geprueft wird deshalb beides:
 * die Form (Host steht in einer Blockregel; jede Allow-Regel auf ihn ist auf
 * Seiten begrenzt) und die WIRKUNG (eine konkrete Anfrage, wie FingerprintJS
 * sie stellt, wird geblockt).
 *
 * `fingerprint.com` ist ein Sonderfall: Das ist auch die Website des
 * Anbieters, und eine Regel auf den ganzen Host naehme sie mit. Geblockt sind
 * die Sammelstellen: `c.fingerprint.com`, `fpc.fingerprint.com` (die Hosts
 * der Proxy-Integration) und `||fingerprint.com/events/` (der Pfad, an den
 * das Skript die Merkmale schickt). Genau das wird hier geprueft, nicht ein
 * Eintrag `fingerprint.com` in einer Liste, den es aus gutem Grund nicht gibt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DnrRegel } from '../../src/engine/dnr-typen.ts';
import { entscheidung } from './hilfen.ts';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const liesJson = (...p: string[]) => JSON.parse(readFileSync(join(wurzel, ...p), 'utf8'));

type Quelle = { id: string; standard?: boolean };

/** Die Regeln aller ab Werk aktiven Listen, je mit Herkunft. */
function abWerkAktiv(): { id: string; regeln: DnrRegel[] }[] {
  const quellen: Quelle[] = liesJson('listen', 'quellen.json');
  const aus: { id: string; regeln: DnrRegel[] }[] = [];
  for (const q of quellen) {
    if (q.standard !== true) continue;
    const pfad = join(wurzel, 'rules', `${q.id}.json`);
    // Eine fehlende Datei ist hier kein Fehler des Tests: `listen:bauen` ist
    // dann nicht gelaufen. Ob ALLE Dateien da sind, prueft `schema.test.ts`.
    if (!existsSync(pfad)) continue;
    aus.push({ id: q.id, regeln: liesJson('rules', `${q.id}.json`) });
  }
  return aus;
}

const listen = abWerkAktiv();
const alle: DnrRegel[] = listen.flatMap((l) => l.regeln);

/** Trifft die Bedingung diesen Host (als Eintrag oder als Subdomain davon)? */
function nenntHost(regel: DnrRegel, host: string): boolean {
  const b = regel.condition;
  if ((b.urlFilter ?? '').includes(host)) return true;
  return (b.requestDomains ?? []).some((d) => d === host || d.endsWith(`.${host}`));
}

/**
 * Die Hosts, so wie FingerprintJS sie anspricht.
 *
 * `anfragen`: konkrete Adressen, die das Skript laedt bzw. an die es sendet.
 * Sie muessen von einer beliebigen fremden Seite aus geblockt sein. Die
 * Adressen sind Muster aus der oeffentlichen Doku des Anbieters, keine
 * Geheimnisse.
 */
const HOSTS: { host: string; anfragen: { url: string; typ: 'script' | 'xmlhttprequest' }[] }[] = [
  {
    host: 'openfpcdn.io',
    anfragen: [
      { url: 'https://openfpcdn.io/fingerprintjs/v4/iife.min.js', typ: 'script' },
      { url: 'https://openfpcdn.io/fingerprintjs/v3/iife.min.js', typ: 'script' },
      { url: 'https://openfpcdn.io/botd/v1', typ: 'script' },
    ],
  },
  {
    host: 'fpjscdn.net',
    anfragen: [{ url: 'https://fpjscdn.net/v3/beispielschluessel/iife.min.js', typ: 'script' }],
  },
  {
    host: 'fpcdn.io',
    anfragen: [{ url: 'https://fpcdn.io/v3/beispielschluessel/iife.min.js', typ: 'script' }],
  },
  {
    host: 'fpjs.io',
    anfragen: [
      { url: 'https://api.fpjs.io/', typ: 'xmlhttprequest' },
      { url: 'https://eu.api.fpjs.io/', typ: 'xmlhttprequest' },
    ],
  },
  {
    host: 'fingerprint.com',
    anfragen: [
      { url: 'https://c.fingerprint.com/abc', typ: 'xmlhttprequest' },
      { url: 'https://fpc.fingerprint.com/abc', typ: 'xmlhttprequest' },
      { url: 'https://fingerprint.com/events/', typ: 'xmlhttprequest' },
    ],
  },
];

/** Eine beliebige fremde Seite als Ausloeser; keine der Reparatur-Ausnahmen. */
const FREMDE_SEITE = 'https://beispiel.example/';

test('die ab Werk aktiven Listen sind gebaut', () => {
  assert.ok(listen.length > 0, 'keine rules/*.json gefunden; erst `npm run listen:bauen`');
  assert.ok(
    listen.some((l) => l.id === 'privatsphaere'),
    'EasyPrivacy (rules/privatsphaere.json) fehlt; dort stehen die Fingerprint-CDNs',
  );
});

for (const { host, anfragen } of HOSTS) {
  test(`${host}: mindestens eine Blockregel nennt den Host`, () => {
    const treffer = alle.filter((r) => r.action.type === 'block' && nenntHost(r, host));
    assert.ok(treffer.length > 0, `keine Blockregel fuer ${host} in ${listen.map((l) => l.id).join(', ')}`);
  });

  test(`${host}: jede Allow-Regel auf den Host ist auf einzelne Seiten begrenzt`, () => {
    // Eine Allow-Regel ohne `initiatorDomains` gilt ueberall und hoebe die
    // Sperre wieder auf. Die bestehenden (collinsdictionary.com,
    // mos03education.ru) reparieren je eine Seite, die ohne das Skript nicht
    // laedt; das ist der Preis, und er ist klein, solange er begrenzt bleibt.
    const offen = alle.filter(
      (r) =>
        (r.action.type === 'allow' || r.action.type === 'allowAllRequests') &&
        nenntHost(r, host) &&
        !(r.condition.initiatorDomains && r.condition.initiatorDomains.length > 0),
    );
    assert.equal(
      offen.length,
      0,
      `${offen.length} Allow-Regel(n) fuer ${host} ohne initiatorDomains: ${JSON.stringify(offen.map((r) => r.condition))}`,
    );
  });

  test(`${host}: eine Anfrage von einer fremden Seite wird geblockt`, () => {
    for (const { url, typ } of anfragen) {
      const e = entscheidung(alle, { url, initiator: FREMDE_SEITE, typ });
      assert.ok(e, `${url}: keine Regel passt`);
      assert.equal(e!.aktion, 'block', `${url}: ${e!.aktion} statt block (Regel ${JSON.stringify(e!.regel.condition)})`);
    }
  });
}

test('die Reparatur-Ausnahme fuer openfpcdn.io greift nur auf ihrer Seite', () => {
  // Der Gegenbeweis zum Test darueber: Auf der Seite, fuer die die Ausnahme
  // gemacht ist, gilt sie; das zeigt, dass der Abgleich in `hilfen.ts`
  // Allow-Regeln ueberhaupt sieht und der Test oben nicht aus Blindheit gruen
  // ist.
  const ausnahmen = alle.filter(
    (r) => r.action.type === 'allow' && (r.condition.urlFilter ?? '').startsWith('||openfpcdn.io/'),
  );
  assert.ok(ausnahmen.length > 0, 'keine Allow-Regel fuer openfpcdn.io mehr; dann diesen Test anpassen');
  for (const r of ausnahmen) {
    const seite = r.condition.initiatorDomains![0];
    const url = `https://${r.condition.urlFilter!.slice(2)}`;
    const e = entscheidung(alle, { url, initiator: `https://${seite}/`, typ: 'script' });
    assert.equal(e?.aktion, 'allow', `${url} von ${seite}: ${e?.aktion}`);
  }
});

test('die Website des Anbieters selbst ist nicht als Ganzes gesperrt', () => {
  // Wer nachlesen will, was FingerprintJS tut, soll das koennen. Eine
  // Navigation zu fingerprint.com wird von keiner der ab Werk aktiven Listen
  // geblockt; nur die Sammelstellen sind es (siehe Kopf).
  const e = entscheidung(alle, { url: 'https://fingerprint.com/', typ: 'main_frame' });
  assert.notEqual(e?.aktion, 'block', `fingerprint.com als Navigation geblockt durch ${JSON.stringify(e?.regel.condition)}`);
});
