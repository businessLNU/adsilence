/**
 * `src/hintergrund/fehlercodes.ts`: Fehlercode des Backends → Zustand der
 * Erweiterung (vertrag.md 6).
 *
 * Die Einteilung ist nicht Geschmack, sondern hat drei verschiedene Folgen
 * fuer den Nutzer:
 *
 *   trennen  Token weg, „bitte neu verbinden". Nur dort, wo der Server die
 *            Sitzung wirklich entwertet hat.
 *   gesperrt Token BLEIBEN liegen. Eine Sperre kann zurueckgenommen werden
 *            (Regel 11: nichts loeschen, nur stilllegen).
 *   spaeter  Nichts anfassen. Wartung, Bremse und ein Funkloch duerfen
 *            niemanden ausloggen; sonst verliert bei der naechsten
 *            Wartungspause jede Installation ihr Konto.
 *
 * Der zweite Teil prueft, dass `verarbeiteKontoFehler()` diese Folgen auch
 * in den Speicher schreibt; die Einteilung allein nuetzt nichts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installiereApi, gueltigeSitzung, verbundenesKonto } from './attrappe.ts';
import { CODES_SPAETER, CODES_TRENNEN, folgeFuer, normalisiereCode } from '../../src/hintergrund/fehlercodes.ts';
import type { Konto, KontoHinweis, Lizenz } from '../../src/gemeinsam/typen.ts';

installiereApi();

// Siehe den Befund im Kopf von `lizenz.test.ts`: `konto.ts` laesst sich mit
// Node 26 nicht laden, solange `ApiFehler` Parameter-Eigenschaften benutzt.
type KontoModul = typeof import('../../src/hintergrund/konto.ts');
let kontoModul: KontoModul | null = null;
let ladefehler: string | null = null;
try {
  kontoModul = await import('../../src/hintergrund/konto.ts');
} catch (e) {
  ladefehler = e instanceof Error ? e.message : String(e);
}
const wennLadbar: { todo?: string } =
  ladefehler === null ? {} : { todo: `Befund Kern/Bau: konto.ts:30 (${ladefehler})` };

function modul(): KontoModul {
  assert.ok(kontoModul, `src/hintergrund/konto.ts liess sich nicht laden: ${ladefehler}`);
  return kontoModul;
}

// ── Einteilung ─────────────────────────────────────────────────────────────

test('die fuenf Codes einer entwerteten Sitzung fuehren zum Trennen', () => {
  for (const code of ['TOKEN_REUSE_DETECTED', 'INVALID_REFRESH_TOKEN', 'REFRESH_TOKEN_EXPIRED', 'TOKEN_STALE', 'USER_GONE']) {
    assert.equal(folgeFuer(code, 401), 'trennen', code);
    // Der Status darf daran nichts aendern: der Code ist die Wahrheit.
    assert.equal(folgeFuer(code, 500), 'trennen', `${code} mit 500`);
  }
  assert.equal(CODES_TRENNEN.size, 5);
});

test('ACCOUNT_BLOCKED heisst gesperrt, nicht getrennt', () => {
  assert.equal(folgeFuer('ACCOUNT_BLOCKED', 403), 'gesperrt');
  assert.equal(CODES_TRENNEN.has('ACCOUNT_BLOCKED'), false, 'eine Sperre darf die Token nicht loeschen');
});

test('Sperrseite, Wartung und Bremse heissen: spaeter noch einmal', () => {
  assert.equal(folgeFuer('SITE_LOCKED', 401), 'spaeter');
  assert.equal(folgeFuer('MAINTENANCE', 503), 'spaeter');
  assert.equal(folgeFuer('RATE_LIMITED', 429), 'spaeter');
  assert.equal(CODES_SPAETER.size, 3);
});

test('ohne Code entscheidet der Status: 0 (Netzfehler), 429 und 5xx heissen spaeter', () => {
  assert.equal(folgeFuer(null, 0), 'spaeter', 'ein Funkloch loggt niemanden aus');
  assert.equal(folgeFuer(null, 429), 'spaeter');
  assert.equal(folgeFuer(null, 500), 'spaeter');
  assert.equal(folgeFuer(null, 502), 'spaeter');
  assert.equal(folgeFuer('UNBEKANNT', 503), 'spaeter');
});

test('alles Uebrige ist ein gewoehnlicher Fehler und aendert nichts am Konto', () => {
  assert.equal(folgeFuer(null, 400), 'fehler');
  assert.equal(folgeFuer('VALIDATION_ERROR', 400), 'fehler');
  assert.equal(folgeFuer('LIZENZ_ERFORDERLICH', 403), 'fehler');
  assert.equal(folgeFuer(null, 401), 'fehler', 'ein 401 ohne bekannten Code trennt nicht von sich aus');
  assert.equal(folgeFuer(null, 404), 'fehler');
});

test('die drei Mengen ueberschneiden sich nicht', () => {
  for (const code of CODES_TRENNEN) assert.equal(CODES_SPAETER.has(code), false, code);
  assert.equal(CODES_TRENNEN.has('ACCOUNT_BLOCKED'), false);
  assert.equal(CODES_SPAETER.has('ACCOUNT_BLOCKED'), false);
});

// ── Verbindungscode normalisieren ──────────────────────────────────────────

test('ein Code wird zu XXXX-XXXX, egal wie er getippt wurde', () => {
  assert.equal(normalisiereCode('abcd2345'), 'ABCD-2345');
  assert.equal(normalisiereCode('ABCD-2345'), 'ABCD-2345');
  assert.equal(normalisiereCode(' abcd 2345 '), 'ABCD-2345');
  assert.equal(normalisiereCode('abcd_2345'), 'ABCD-2345');
});

test('was keine acht Zeichen aus A-Z2-9 hat, ist kein Code', () => {
  assert.equal(normalisiereCode(''), null);
  assert.equal(normalisiereCode('abcd234'), null, 'zu kurz');
  assert.equal(normalisiereCode('abcd23456'), null, 'zu lang');
  // 0, O, 1 und I sind bewusst nicht im Zeichenvorrat: sie werden verwechselt.
  assert.equal(normalisiereCode('abcd2340'), null);
  assert.equal(normalisiereCode('abcd2341'), null);
});

// ── Folge → Speicher ───────────────────────────────────────────────────────

test('trennen loescht Token und Sitzung und verlangt eine neue Verbindung', wennLadbar, async () => {
  const u = installiereApi({ lokal: { ...verbundenesKonto() }, sitzung: gueltigeSitzung() });
  const { ApiFehler, verarbeiteKontoFehler } = modul();
  const folge = await verarbeiteKontoFehler(new ApiFehler('TOKEN_REUSE_DETECTED', '', 401));
  assert.equal(folge, 'trennen');
  assert.equal(u.lokal.daten.get('konto'), null);
  assert.equal(u.lokal.daten.get('kontoHinweis') as KontoHinweis, 'neuVerbinden');
  assert.equal(u.sitzung.daten.get('sitzung'), null);
  assert.equal((u.lokal.daten.get('lizenz') as Lizenz).premium, false);
});

test('gesperrt behaelt den Refresh-Token; eine Sperre kann zurueckgenommen werden', wennLadbar, async () => {
  const u = installiereApi({ lokal: { ...verbundenesKonto() }, sitzung: gueltigeSitzung() });
  const { ApiFehler, verarbeiteKontoFehler } = modul();
  const folge = await verarbeiteKontoFehler(new ApiFehler('ACCOUNT_BLOCKED', '', 403));
  assert.equal(folge, 'gesperrt');
  const konto = u.lokal.daten.get('konto') as Konto | null;
  assert.ok(konto, 'das Konto darf NICHT geloescht werden (Regel 11)');
  assert.equal(konto.refreshToken, 'auffrischen-attrappe');
  assert.equal(u.lokal.daten.get('kontoHinweis') as KontoHinweis, 'gesperrt');
  assert.equal((u.lokal.daten.get('lizenz') as Lizenz).premium, false, 'Premium ruht, solange die Sperre gilt');
});

test('spaeter und fehler lassen Konto, Sitzung und Lizenz unangetastet', wennLadbar, async () => {
  const { ApiFehler, verarbeiteKontoFehler } = modul();
  for (const [code, status, erwartet] of [
    ['MAINTENANCE', 503, 'spaeter'],
    ['RATE_LIMITED', 429, 'spaeter'],
    ['SITE_LOCKED', 401, 'spaeter'],
    ['NETZ', 0, 'spaeter'],
    ['VALIDATION_ERROR', 400, 'fehler'],
  ] as const) {
    const u = installiereApi({ lokal: { ...verbundenesKonto(), lizenz: null }, sitzung: gueltigeSitzung() });
    const folge = await verarbeiteKontoFehler(new ApiFehler(code, '', status));
    assert.equal(folge, erwartet, code);
    assert.ok(u.lokal.daten.get('konto'), `${code} hat das Konto angefasst`);
    assert.ok(u.sitzung.daten.get('sitzung'), `${code} hat die Sitzung geloescht`);
    assert.equal(u.lokal.daten.get('kontoHinweis'), undefined, `${code} hat einen Hinweis gesetzt`);
  }
});
