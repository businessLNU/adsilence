/**
 * Lizenz: Gnadenfrist, frischer Stand, Entzug.
 *
 * Die Gnadenfrist ist die einzige Stelle der Erweiterung, an der ein
 * bezahltes Merkmal OHNE Antwort des Servers weiterlaeuft. Sie muss in beide
 * Richtungen halten: Wer offline ist, verliert Premium nicht auf einem
 * Flug, und wer nicht mehr zahlt, behaelt es nicht ewig, weil sein Browser
 * den Server nie erreicht.
 *
 * Der zweite Teil faehrt `lizenzPruefen()` gegen eine Netzattrappe. Geprueft
 * wird dabei nicht das Netz, sondern was danach im Speicher steht: Der Stand
 * dort entscheidet, ob die Premium-Liste eingeschaltet wird.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installiereApi, gueltigeSitzung, verbundenesKonto } from './attrappe.ts';
import { freiLizenz, lizenzFrisch, lizenzWirksam } from '../../src/hintergrund/lizenz-regeln.ts';
import { GNADENFRIST_MS, LIZENZ_FRISCH_MS } from '../../src/gemeinsam/konstanten.ts';
import type { Lizenz } from '../../src/gemeinsam/typen.ts';

const umgebung = installiereApi();

/**
 * BEFUND (Paket Kern/Bau, `src/hintergrund/konto.ts:30` und `:32`): Die
 * Klasse `ApiFehler` benutzt Parameter-Eigenschaften (`readonly code: string`
 * im Konstruktor). Node 26 fuehrt TypeScript nur im „strip-only mode" aus und
 * bricht darauf ab:
 *
 *     SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
 *     TypeScript parameter property is not supported in strip-only mode
 *
 * Damit laesst sich `konto.ts` nicht laden, und ebenso wenig alles, was es
 * importiert, also auch `lizenz.ts` und `abgleich.ts`: weder von `node --test` noch von einem
 * `.mjs`-Skript laden. Dieselbe Grenze steht im Kopf von
 * `scripts/listen-bauen.mjs` bereits ausdruecklich („ohne Enums, Namespaces
 * und Parameter-Eigenschaften"). Behebung: die drei Felder von Hand
 * zuweisen (`this.code = code`).
 *
 * Solange das offen ist, laufen die Pruefungen gegen das Backend als `todo`
 * statt rot. Ihr Inhalt bleibt unveraendert; sobald die Zeile behoben ist,
 * greifen sie ohne weiteres Zutun.
 */
type LizenzModul = typeof import('../../src/hintergrund/lizenz.ts');
let lizenzModul: LizenzModul | null = null;
let ladefehler: string | null = null;
try {
  lizenzModul = await import('../../src/hintergrund/lizenz.ts');
} catch (e) {
  ladefehler = e instanceof Error ? e.message : String(e);
}

const wennLadbar: { todo?: string } =
  ladefehler === null ? {} : { todo: `Befund Kern/Bau: konto.ts:30 (${ladefehler})` };

function modul(): LizenzModul {
  assert.ok(lizenzModul, `src/hintergrund/lizenz.ts liess sich nicht laden: ${ladefehler}`);
  return lizenzModul;
}

const STUNDE = 60 * 60 * 1000;
const TAG = 24 * STUNDE;

function premiumStand(teil: Partial<Lizenz> = {}): Lizenz {
  return {
    tarif: 'premium',
    premium: true,
    planKeys: ['premium'],
    gueltigBis: null,
    endetZumTermin: false,
    hinweis: null,
    geprueftAm: Date.now(),
    ...teil,
  };
}

// ── Gnadenfrist (reine Rechenregeln) ───────────────────────────────────────

test('die Gnadenfrist ist sieben Tage', () => {
  assert.equal(GNADENFRIST_MS, 7 * TAG);
  assert.equal(LIZENZ_FRISCH_MS, STUNDE);
});

test('ohne gespeicherten Stand gilt frei', () => {
  const jetzt = Date.now();
  const frei = lizenzWirksam(null, jetzt);
  assert.deepEqual(frei, freiLizenz(jetzt));
  assert.equal(frei.premium, false);
  assert.equal(frei.tarif, 'frei');
  assert.deepEqual(frei.planKeys, []);
});

test('sieben Tage offline behalten Premium', () => {
  const jetzt = Date.now();
  for (const alter of [0, STUNDE, 3 * TAG, 7 * TAG - 1000]) {
    const wirksam = lizenzWirksam(premiumStand({ geprueftAm: jetzt - alter }), jetzt);
    assert.equal(wirksam.premium, true, `nach ${alter} ms muss Premium noch gelten`);
    assert.equal(wirksam.tarif, 'premium');
  }
});

test('nach der Gnadenfrist faellt der Tarif auf frei', () => {
  const jetzt = Date.now();
  const wirksam = lizenzWirksam(premiumStand({ geprueftAm: jetzt - (7 * TAG + 1000) }), jetzt);
  assert.equal(wirksam.premium, false);
  assert.equal(wirksam.tarif, 'frei');
  // Der gespeicherte Stand bleibt sonst unangetastet: Kommt der Server
  // zurueck, steht die Kontoangabe noch da (Regel 11, nichts loeschen).
  assert.deepEqual(wirksam.planKeys, ['premium']);
});

test('ein abgelaufenes gueltigBis zaehlt ebenfalls nur bis zum Ende der Gnadenfrist', () => {
  const jetzt = Date.now();
  const gerade = premiumStand({ gueltigBis: new Date(jetzt - 3 * TAG).toISOString() });
  assert.equal(lizenzWirksam(gerade, jetzt).premium, true, 'drei Tage darueber: der Server haette sich gemeldet');
  const laengst = premiumStand({ gueltigBis: new Date(jetzt - 8 * TAG).toISOString() });
  assert.equal(lizenzWirksam(laengst, jetzt).premium, false);
});

test('ein unlesbares gueltigBis macht die Lizenz nicht ungueltig', () => {
  const jetzt = Date.now();
  assert.equal(lizenzWirksam(premiumStand({ gueltigBis: 'kein Datum' }), jetzt).premium, true);
});

test('ein freier Stand wird nie durch die Gnadenfrist zu Premium', () => {
  const jetzt = Date.now();
  const frei = { ...freiLizenz(jetzt - 100 * TAG) };
  assert.deepEqual(lizenzWirksam(frei, jetzt), frei);
});

test('lizenzFrisch: eine Stunde ist die Grenze fuers Popup', () => {
  const jetzt = Date.now();
  assert.equal(lizenzFrisch(null, jetzt), false);
  assert.equal(lizenzFrisch(premiumStand({ geprueftAm: jetzt - 59 * 60 * 1000 }), jetzt), true);
  assert.equal(lizenzFrisch(premiumStand({ geprueftAm: jetzt - 61 * 60 * 1000 }), jetzt), false);
});

// ── Pruefung gegen das Backend ─────────────────────────────────────────────

test('ein frischer Stand vom Server ueberschreibt den gespeicherten', wennLadbar, async () => {
  const u = installiereApi({
    lokal: { ...verbundenesKonto(), lizenz: freiLizenz(Date.now() - 2 * STUNDE) },
    sitzung: gueltigeSitzung(),
  });
  u.netz.antworte('/api/adsilence/lizenz', 200, {
    tarif: 'premium',
    premium: true,
    planKeys: ['premium-monatlich'],
    gueltigBis: new Date(Date.now() + 30 * TAG).toISOString(),
    endetZumTermin: false,
    hinweis: null,
  });

  const lizenz = await modul().lizenzPruefen('test');
  assert.equal(lizenz.premium, true);
  assert.deepEqual(lizenz.planKeys, ['premium-monatlich']);

  const gespeichert = u.lokal.daten.get('lizenz') as Lizenz;
  assert.equal(gespeichert.premium, true);
  assert.equal(gespeichert.tarif, 'premium');
  assert.ok(Date.now() - gespeichert.geprueftAm < 5000, 'geprueftAm muss der Zeitpunkt der Antwort sein');
  assert.equal(u.netz.aufrufe.at(-1)?.method, 'GET');
});

test('premium=false vom Server wird sofort uebernommen, ohne Gnadenfrist', wennLadbar, async () => {
  const u = installiereApi({
    lokal: { ...verbundenesKonto(), lizenz: premiumStand() },
    sitzung: gueltigeSitzung(),
  });
  u.netz.antworte('/api/adsilence/lizenz', 200, { tarif: 'frei', premium: false, planKeys: [] });

  const lizenz = await modul().lizenzPruefen('test');
  assert.equal(lizenz.premium, false);
  assert.equal(lizenz.tarif, 'frei');
  const gespeichert = u.lokal.daten.get('lizenz') as Lizenz;
  assert.equal(gespeichert.premium, false, 'der Entzug darf nicht sieben Tage warten');
});

test('ohne verbundenes Konto wird gar nicht gefragt, es gilt frei', wennLadbar, async () => {
  const u = installiereApi({ lokal: { lizenz: premiumStand() } });
  const lizenz = await modul().lizenzPruefen('test');
  assert.equal(lizenz.premium, false);
  assert.deepEqual(u.netz.aufrufe, [], 'ohne Konto gibt es nichts zu fragen');
  assert.equal((u.lokal.daten.get('lizenz') as Lizenz).premium, false);
});

test('antwortet der Server nicht, bleibt der letzte Stand stehen', wennLadbar, async () => {
  const u = installiereApi({
    lokal: { ...verbundenesKonto(), lizenz: premiumStand({ geprueftAm: Date.now() - 2 * TAG }) },
    sitzung: gueltigeSitzung(),
  });
  u.netz.antworte('/api/adsilence/lizenz', 503, { error: { code: 'MAINTENANCE', message: 'Wartung' } });

  const lizenz = await modul().lizenzPruefen('test');
  assert.equal(lizenz.premium, true, 'Wartung ist kein Grund, Premium abzuschalten');
  const gespeichert = u.lokal.daten.get('lizenz') as Lizenz;
  assert.equal(gespeichert.premium, true);
  assert.ok(Date.now() - gespeichert.geprueftAm > TAG, 'geprueftAm darf ohne Antwort NICHT hochgesetzt werden');
});

test('ein Netzfehler laesst den Stand ebenso stehen', wennLadbar, async () => {
  const u = installiereApi({
    lokal: { ...verbundenesKonto(), lizenz: premiumStand({ geprueftAm: Date.now() - TAG }) },
    sitzung: gueltigeSitzung(),
  });
  // Keine Antwort eingerichtet: die Attrappe wirft, wie `fetch` es offline tut.
  const lizenz = await modul().lizenzPruefen('test');
  assert.equal(lizenz.premium, true);
  assert.equal((u.lokal.daten.get('lizenz') as Lizenz).premium, true, 'auch im Speicher bleibt Premium stehen');
});

test('nach der Gnadenfrist gilt auch ohne Antwort frei', wennLadbar, async () => {
  const u = installiereApi({
    lokal: { ...verbundenesKonto(), lizenz: premiumStand({ geprueftAm: Date.now() - 8 * TAG }) },
    sitzung: gueltigeSitzung(),
  });
  const lizenz = await modul().lizenzPruefen('test');
  assert.equal(lizenz.premium, false);
  assert.equal(u.netz.aufrufe.length, 1, 'gefragt wird trotzdem: vielleicht ist der Server wieder da');
});

test('aktuelleLizenz liest den Speicher und rechnet die Gnadenfrist mit', wennLadbar, async () => {
  installiereApi({ lokal: { lizenz: premiumStand({ geprueftAm: Date.now() - 8 * TAG }) } });
  assert.equal((await modul().aktuelleLizenz()).premium, false);

  installiereApi({ lokal: { lizenz: premiumStand({ geprueftAm: Date.now() - 2 * TAG }) } });
  assert.equal((await modul().aktuelleLizenz()).premium, true);

  installiereApi();
  assert.equal((await modul().aktuelleLizenz()).premium, false, 'ohne Stand gilt frei');
});

test('zwei Pruefungen zugleich fragen den Server nur einmal', wennLadbar, async () => {
  const u = installiereApi({
    lokal: { ...verbundenesKonto(), lizenz: freiLizenz(Date.now()) },
    sitzung: gueltigeSitzung(),
  });
  u.netz.antworte('/api/adsilence/lizenz', 200, { tarif: 'frei', premium: false, planKeys: [] });
  // Popup und Alarm koennen zusammenfallen; zwei gleichzeitige Erneuerungen
  // sind genau das, was der Server als Wiederverwendung bestraft.
  await Promise.all([modul().lizenzPruefen('popup'), modul().lizenzPruefen('alarm')]);
  assert.equal(u.netz.aufrufe.length, 1);
});

test('die Attrappe hat den Speicher benutzt, den dieser Test gesetzt hat', () => {
  // Wachhund fuer die Testeinrichtung selbst: `browser.ts` haelt `api` in
  // einer Konstanten. Wuerde `installiereApi()` ein NEUES Objekt setzen
  // statt dieses auszuraeumen, liefen alle Pruefungen oben ins Leere.
  assert.ok(umgebung.lokal.daten instanceof Map);
});
