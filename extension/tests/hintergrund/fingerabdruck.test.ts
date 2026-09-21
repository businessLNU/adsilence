/**
 * `src/hintergrund/fingerabdruck.ts` und der Fingerabdruck-Teil von
 * `kosmetikFuer`: das Sitzungs-Token, seine Bindung an die oberste Seite
 * und die Gruende, aus denen das Rauschen aus ist - Einstellung, Ausnahme,
 * AdSilence aus, und seit dem 07.09.2026 die fehlende Lizenz.
 *
 * Der Fall, der hier haengt: Ein Rahmen von `werbung.example` liegt auf
 * `a.example` und auf `b.example`. Bekaeme er beide Male dasselbe Token,
 * saehe er auf beiden Seiten denselben Audio-Wert - und genau das ist das
 * Tracking, gegen das die Schicht gebaut ist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installiereApi } from './attrappe.ts';

// Die Attrappe muss stehen, bevor `browser.ts` sie liest.
let umgebung = installiereApi();
const { sitzungsToken, tokenFuerSeite } = await import('../../src/hintergrund/fingerabdruck.ts');
const { kosmetikFuer } = await import('../../src/hintergrund/kosmetik.ts');

// ── Das Token ──────────────────────────────────────────────────────────────

test('das Token wird einmal erzeugt und in storage.session abgelegt', async () => {
  umgebung = installiereApi();
  // Zwanzig Rahmen einer Seite fragen gleichzeitig: alle bekommen dasselbe.
  const gleichzeitig = await Promise.all(Array.from({ length: 20 }, () => sitzungsToken()));
  const token = gleichzeitig[0]!;
  assert.ok(token.length >= 32, 'ein Token traegt mindestens 128 Bit');
  for (const t of gleichzeitig) assert.equal(t, token);
  assert.equal(umgebung.sitzung.daten.get('fingerabdruckToken'), token, 'liegt in session');
  assert.equal(umgebung.lokal.daten.has('fingerabdruckToken'), false, 'nie in local: dort ueberlebte es die Sitzung');
});

test('ein zweiter Start liest das Token, statt ein neues zu erzeugen', async () => {
  // So sieht der Speicher aus, wenn der Service Worker geschlafen hat und
  // wieder aufwacht: `storage.session` ist noch da, das Modul ist frisch.
  umgebung = installiereApi({ sitzung: { fingerabdruckToken: 'token-aus-der-laufenden-sitzung' } });
  assert.equal(await sitzungsToken(), 'token-aus-der-laufenden-sitzung');
  assert.equal(umgebung.sitzung.daten.get('fingerabdruckToken'), 'token-aus-der-laufenden-sitzung', 'nicht ueberschrieben');
});

test('zwei Browsersitzungen bekommen zwei verschiedene Token', async () => {
  umgebung = installiereApi();
  const erste = await sitzungsToken();
  umgebung = installiereApi();
  const zweite = await sitzungsToken();
  assert.notEqual(erste, zweite);
});

test('ohne storage.session (Safari vor 16.4) bleibt das Token fuer den Prozess stabil', async () => {
  umgebung = installiereApi({ ohneSitzungsspeicher: true });
  const a = await sitzungsToken();
  const b = await sitzungsToken();
  assert.equal(a, b);
  assert.ok(a.length >= 32);
  umgebung = installiereApi();
});

// ── Die Bindung an die oberste Seite ───────────────────────────────────────

test('derselbe Rahmen-Host unter zwei obersten Seiten bekommt zwei verschiedene Token', async () => {
  umgebung = installiereApi();
  const aufA = await tokenFuerSeite('a.example');
  const aufB = await tokenFuerSeite('b.example');
  assert.notEqual(aufA, aufB);
  assert.equal(await tokenFuerSeite('a.example'), aufA, 'dieselbe oberste Seite: dasselbe Token');
  assert.equal(await tokenFuerSeite('A.Example'), aufA, 'Gross- und Kleinschreibung des Hosts spielt keine Rolle');
});

test('die Seite bekommt nie das Sitzungs-Token selbst', async () => {
  umgebung = installiereApi();
  const token = await sitzungsToken();
  const abgeleitet = await tokenFuerSeite('a.example');
  assert.notEqual(abgeleitet, token);
  assert.equal(abgeleitet.includes(token), false);
  assert.match(abgeleitet, /^[0-9a-f]{64}$/, 'SHA-256 als Hex');
});

// ── kosmetikFuer: wann das Rauschen aus ist ────────────────────────────────

/**
 * Eine Lizenz, die JETZT bestaetigt wurde. Ohne sie ist das Rauschen aus:
 * „Fingerabdruck verwischen" ist seit dem 07.09.2026 Premium, geprueft in
 * `fingerabdruckFuer()` und nicht erst am Schalter in den Optionen.
 */
function premiumLizenz(geprueftAm = Date.now()) {
  return {
    tarif: 'premium',
    premium: true,
    planKeys: ['premium'],
    gueltigBis: null,
    endetZumTermin: false,
    hinweis: null,
    geprueftAm,
  };
}

function mitEinstellungen(
  einstellungen: Record<string, unknown>,
  sites: Record<string, unknown> = {},
  lizenz: unknown = premiumLizenz(),
) {
  umgebung = installiereApi({ lokal: { einstellungen, sites, lizenz } });
}

test('an: Einstellung an, keine Ausnahme - mit dem Token der obersten Seite', async () => {
  mitEinstellungen({ aktiv: true, fingerabdruck: true });
  const antwort = await kosmetikFuer('werbung.example', 'a.example');
  assert.equal(antwort.aus, false);
  assert.equal(antwort.fingerabdruck.an, true);
  assert.equal(antwort.fingerabdruck.token, await tokenFuerSeite('a.example'));
});

test('AN ist die Vorgabe: ein Speicher ohne das Feld rauscht - mit Premium', async () => {
  /*
   * Bis zum 08.09.2026 stand hier das Gegenteil, und der Grund dafuer war
   * gut: Das Rauschen kann eine laufende Zahlung stoeren. Nur war der Preis
   * hoeher als der Nutzen - GEMESSEN mit
   * `tests/laufzeit/fingerabdruck-diagnose.mjs` bekam ein Kunde MIT Premium
   * denselben Canvas-Hash wie ein Browser ohne Erweiterung, und Cover Your
   * Tracks meldete ihm „nearly-unique fingerprint". Er zahlte fuer eine
   * Funktion, die stumm auslieferte.
   *
   * Die Zahlung schuetzt jetzt nicht mehr die Vorgabe, sondern
   * `ZAHLUNGSHOSTS` (Test darunter): Die Seite rauscht, der Zahlungsrahmen
   * darin nicht.
   */
  mitEinstellungen({ aktiv: true });
  const antwort = await kosmetikFuer('a.example', 'a.example');
  assert.equal(antwort.fingerabdruck.an, true, 'ohne das Feld gilt die Vorgabe, und die ist AN');
});

test('aber nur mit Premium: ohne Lizenz aendert die Vorgabe nichts', async () => {
  // Die Vorgabe steht auf AN fuer JEDEN Speicher, auch den eines freien
  // Nutzers. Wirksam wird sie erst durch die Lizenz - sonst waere aus einer
  // geaenderten Vorgabe versehentlich eine verschenkte Premium-Funktion
  // geworden.
  mitEinstellungen({ aktiv: true }, {}, null);
  const antwort = await kosmetikFuer('a.example', 'a.example');
  assert.deepEqual(antwort.fingerabdruck, { an: false, token: null });
});

test('im Zahlungsrahmen wird nie gerauscht, auch wenn die Seite rauscht', async () => {
  /*
   * Der teuerste Fehler, den diese Erweiterung machen kann, ist eine
   * abgelehnte Karte. Stripe, Adyen und PayPal Fraudnet lesen Canvas und
   * Audio als Betrugsmerkmal; ein Rahmen, der ihnen etwas anderes zeigt als
   * beim letzten Mal, sieht aus wie ein uebernommenes Geraet.
   *
   * Geprueft wird der RAHMEN, nicht die oberste Seite: Der Shop soll
   * rauschen.
   */
  mitEinstellungen({ aktiv: true, fingerabdruck: true });
  for (const rahmen of ['js.stripe.com', 'm.stripe.network', 'checkoutshopper-live.adyen.com', 'c.paypal.com']) {
    const antwort = await kosmetikFuer(rahmen, 'shop.example');
    assert.deepEqual(antwort.fingerabdruck, { an: false, token: null }, rahmen);
  }
  // Die Seite drumherum rauscht weiter - sonst waere jeder Shop mit einem
  // Zahlungsrahmen ungeschuetzt.
  const seite = await kosmetikFuer('shop.example', 'shop.example');
  assert.equal(seite.fingerabdruck.an, true);
  // Und ein Host, der nur so aehnlich heisst, ist keiner.
  const falsch = await kosmetikFuer('nicht-stripe.com', 'shop.example');
  assert.equal(falsch.fingerabdruck.an, true, 'die Liste darf nicht auf Teilstrings treffen');
});

test('aus: kein Premium - die Einstellung allein reicht nicht', async () => {
  // Der Schalter in den Optionen ist ohne Premium eine Attrappe. Wer den
  // Speicher von Hand setzt, umgeht die Attrappe, nicht aber diese Pruefung.
  mitEinstellungen({ aktiv: true, fingerabdruck: true }, {}, null);
  const antwort = await kosmetikFuer('werbung.example', 'a.example');
  assert.equal(antwort.aus, false, 'die Kosmetik laeuft weiter');
  assert.deepEqual(antwort.fingerabdruck, { an: false, token: null });
});

test('aus: die Lizenz ist laenger als die Gnadenfrist unbestaetigt', async () => {
  // Dieselbe Rechnung wie bei den Premium-Listen: `lizenzWirksam` laesst
  // einen Stand, den der Server seit ueber sieben Tagen nicht bestaetigt
  // hat, auf frei zurueckfallen.
  const achtTage = Date.now() - 8 * 24 * 60 * 60 * 1000;
  mitEinstellungen({ aktiv: true, fingerabdruck: true }, {}, premiumLizenz(achtTage));
  const antwort = await kosmetikFuer('werbung.example', 'a.example');
  assert.deepEqual(antwort.fingerabdruck, { an: false, token: null });
});

test('aus: die Einstellung ist aus', async () => {
  mitEinstellungen({ aktiv: true, fingerabdruck: false });
  const antwort = await kosmetikFuer('werbung.example', 'a.example');
  assert.equal(antwort.aus, false, 'die Kosmetik laeuft weiter');
  assert.deepEqual(antwort.fingerabdruck, { an: false, token: null });
});

test('aus: AdSilence ist aus', async () => {
  mitEinstellungen({ aktiv: false, fingerabdruck: true });
  const antwort = await kosmetikFuer('werbung.example', 'a.example');
  assert.equal(antwort.aus, true);
  assert.deepEqual(antwort.fingerabdruck, { an: false, token: null });
});

test('aus: die oberste Seite ist Ausnahme - auch fuer den Rahmen darin', async () => {
  // Wer `shop.example` freigibt, weil die Zahlung hakt, hat den
  // Zahlungsrahmen mit freigegeben. Der Rahmen-Host selbst ist KEINE Ausnahme.
  mitEinstellungen({ aktiv: true, fingerabdruck: true }, { 'shop.example': { erlaubt: true, seit: 1 } });
  const antwort = await kosmetikFuer('zahlung.example', 'shop.example');
  assert.equal(antwort.aus, false, 'die Kosmetik im Rahmen laeuft weiter, der Rahmen-Host ist keine Ausnahme');
  assert.deepEqual(antwort.fingerabdruck, { an: false, token: null });
});

test('aus: der Rahmen-Host ist Ausnahme, die oberste Seite nicht', async () => {
  mitEinstellungen({ aktiv: true, fingerabdruck: true }, { 'zahlung.example': { erlaubt: true, seit: 1 } });
  const antwort = await kosmetikFuer('zahlung.example', 'shop.example');
  assert.equal(antwort.aus, true);
  assert.deepEqual(antwort.fingerabdruck, { an: false, token: null });
});

test('eine Ausnahme fuer die Domain darueber zaehlt wie eine fuer den Host', async () => {
  mitEinstellungen({ aktiv: true, fingerabdruck: true }, { 'example.org': { erlaubt: true, seit: 1 } });
  const antwort = await kosmetikFuer('werbung.example', 'www.example.org');
  assert.equal(antwort.fingerabdruck.an, false);
});

test('ein Rahmen ohne Host (leerer Host) bekommt die Entscheidung der obersten Seite', async () => {
  // Firefox: about:blank unter einem Elternrahmen fremder Herkunft, kein
  // `ancestorOrigins`. Das Inhaltsskript fragt mit host '' und die oberste
  // Seite aus `sender.tab.url` entscheidet.
  mitEinstellungen({ aktiv: true, fingerabdruck: true });
  const an = await kosmetikFuer('', 'a.example');
  assert.equal(an.fingerabdruck.an, true);
  assert.equal(an.fingerabdruck.token, await tokenFuerSeite('a.example'));
  assert.deepEqual(an.selektoren, []);
  mitEinstellungen({ aktiv: true, fingerabdruck: true }, { 'a.example': { erlaubt: true, seit: 1 } });
  const aus = await kosmetikFuer('', 'a.example');
  assert.deepEqual(aus.fingerabdruck, { an: false, token: null });
  const { pruefeNachricht } = await import('../../src/hintergrund/pruefung.ts');
  assert.deepEqual(pruefeNachricht({ typ: 'kosmetik', host: '' }), { typ: 'kosmetik', host: '' });
  assert.equal(pruefeNachricht({ typ: 'kosmetik', host: 'Nicht Gueltig' }), null);
  assert.equal(pruefeNachricht({ typ: 'verwechslung.pruefen', host: '' }), null, 'nur die Kosmetik nimmt den leeren Host');
});

test('ohne oberste Seite gilt der Rahmen selbst als oberste Seite', async () => {
  mitEinstellungen({ aktiv: true, fingerabdruck: true });
  const antwort = await kosmetikFuer('a.example');
  assert.equal(antwort.fingerabdruck.an, true);
  assert.equal(antwort.fingerabdruck.token, await tokenFuerSeite('a.example'));
});
