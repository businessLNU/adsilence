/**
 * `src/gemeinsam/speicher.ts`: Vorgaben und Migration.
 *
 * Der Fall, der hier haengt: Nach einem Update fehlt ein NEUES Feld im
 * gespeicherten Objekt. Wer es dann ungeprueft liest, bekommt `undefined`
 * und schreibt es weiter; aus `zaehlerBadge: undefined` wird ein Badge, der
 * weder an noch aus ist. Deshalb mischt `liesLokal` die Einstellungen flach
 * mit der Vorgabe, und deshalb steht das hier als eigener Test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installiereApi } from './attrappe.ts';

// Die Attrappe muss stehen, bevor `browser.ts` sie liest.
const umgebung = installiereApi();
const { EINSTELLUNGEN_VORGABE, LOKAL_VORGABE, SITZUNG_VORGABE, liesLokal, liesSitzung, migriereSpeicher, schreibeLokal, schreibeSitzung } =
  await import('../../src/gemeinsam/speicher.ts');
const { SPEICHER_VERSION } = await import('../../src/gemeinsam/konstanten.ts');

function leere(): void {
  umgebung.lokal.daten.clear();
  umgebung.sitzung.daten.clear();
}

// ── Vorgaben ───────────────────────────────────────────────────────────────

test('ein leerer Speicher liefert fuer jeden Schluessel seine Vorgabe', async () => {
  leere();
  const alles = await liesLokal(
    'einstellungen',
    'sites',
    'konto',
    'kontoHinweis',
    'lizenz',
    'eigeneRegeln',
    'verbindungOffen',
    'abgleich',
    'stand',
  );
  assert.deepEqual(alles.einstellungen, EINSTELLUNGEN_VORGABE);
  assert.deepEqual(alles.sites, {});
  assert.equal(alles.konto, null);
  assert.equal(alles.kontoHinweis, null);
  assert.equal(alles.lizenz, null);
  assert.equal(alles.eigeneRegeln, '');
  assert.equal(alles.verbindungOffen, null);
  assert.deepEqual(alles.abgleich, { version: 0, aktualisiertAm: null });
  assert.deepEqual(alles.stand, { version: SPEICHER_VERSION });
});

test('die Vorgabe schaltet AdSilence ein und den Badge dazu', () => {
  assert.equal(EINSTELLUNGEN_VORGABE.aktiv, true);
  assert.equal(EINSTELLUNGEN_VORGABE.zaehlerBadge, true);
  assert.equal(EINSTELLUNGEN_VORGABE.thema, 'system');
  assert.equal(EINSTELLUNGEN_VORGABE.sprache, null, 'ohne Wahl gilt die Browsersprache, nicht Deutsch');
  assert.deepEqual(EINSTELLUNGEN_VORGABE.listen, {});
});

test('ein halb gefuelltes Einstellungsobjekt wird mit der Vorgabe aufgefuellt', async () => {
  leere();
  // So sieht der Speicher aus, wenn ein Update ein Feld hinzugefuegt hat.
  await umgebung.lokal.set({ einstellungen: { aktiv: false, listen: { basis: false } } });
  const { einstellungen } = await liesLokal('einstellungen');
  assert.equal(einstellungen.aktiv, false, 'der gespeicherte Wert gewinnt');
  assert.deepEqual(einstellungen.listen, { basis: false });
  assert.equal(einstellungen.zaehlerBadge, true, 'das neue Feld kommt aus der Vorgabe');
  assert.equal(einstellungen.thema, 'system');
});

test('schreibeLokal fasst nur an, was uebergeben wurde', async () => {
  leere();
  await schreibeLokal({ eigeneRegeln: '||a.example^' });
  await schreibeLokal({ kontoHinweis: 'gesperrt' });
  const { eigeneRegeln, kontoHinweis } = await liesLokal('eigeneRegeln', 'kontoHinweis');
  assert.equal(eigeneRegeln, '||a.example^');
  assert.equal(kontoHinweis, 'gesperrt');
});

test('storage.session hat eigene Vorgaben und wird getrennt geschrieben', async () => {
  leere();
  const leerStand = await liesSitzung('sitzung', 'listenFehler', 'verbindungFehler', 'fingerabdruckToken');
  assert.deepEqual(leerStand, SITZUNG_VORGABE);
  await schreibeSitzung({ listenFehler: 'laestig' });
  assert.equal((await liesSitzung('listenFehler')).listenFehler, 'laestig');
  assert.equal(umgebung.lokal.daten.has('listenFehler'), false, 'nichts davon gehoert in local');
});

test('ohne storage.session (Safari vor 16.4) gilt „nichts da", ohne Absturz', async () => {
  // Eine zweite Attrappe im selben Prozess: `speicher.ts` liest `api.storage`
  // bei JEDEM Aufruf neu, nur `api` selbst steht fest.
  const ohne = installiereApi({ ohneSitzungsspeicher: true });
  assert.equal(ohne.sitzung.daten.size, 0);
  const stand = await liesSitzung('sitzung', 'listenFehler');
  assert.deepEqual(stand, { sitzung: null, listenFehler: null });
  await assert.doesNotReject(() => schreibeSitzung({ listenFehler: 'x' }));
  // Fuer die folgenden Tests wieder die vollstaendige Attrappe.
  installiereApi();
});

// ── Migration ──────────────────────────────────────────────────────────────

test('die Migration ueberschreibt keinen vorhandenen Wert', async () => {
  const alt = installiereApi({
    lokal: {
      einstellungen: { aktiv: false, listen: { basis: false }, sprache: 'fr', thema: 'dunkel', zaehlerBadge: false },
      eigeneRegeln: '||a.example^',
      // `stand` fehlt: so sieht ein Speicher aus, der vor der Versionierung
      // geschrieben wurde.
    },
  });
  await migriereSpeicher();
  assert.equal(alt.lokal.daten.get('eigeneRegeln') as string, '||a.example^');
  const nachher = alt.lokal.daten.get('einstellungen') as Record<string, unknown>;
  // Die eigenen Werte stehen unveraendert da.
  assert.deepEqual(nachher.listen, { basis: false });
  assert.equal(nachher.sprache, 'fr');
  assert.equal(nachher.thema, 'dunkel');
  assert.equal(nachher.zaehlerBadge, false);
  // Die EINE Ausnahme: Version 2 holt jeden aus dem Aus zurueck. Der Schalter
  // „AdSilence aktiv" ist am 07.09.2026 aus den Optionen verschwunden; wer auf
  // `false` stand, haette danach keinen Weg zurueck (siehe `speicher.ts`).
  assert.equal(nachher.aktiv, true, 'aktiv wird bewusst auf true gezogen');
});

test('Version 3 holt den Fingerabdruckschutz einmalig nach vorn', async () => {
  /*
   * Der Fall, der diese Migration ausgeloest hat: eine INSTALLIERTE
   * Erweiterung. Eine geaenderte Vorgabe erreicht sie nicht - in ihrem
   * Speicher steht `fingerabdruck: false`, und dort bleibt es. Genau dort
   * sitzt der zahlende Kunde, dem Cover Your Tracks am 08.09.2026
   * „nearly-unique fingerprint" meldete.
   */
  const alt = installiereApi({
    lokal: {
      einstellungen: { aktiv: true, listen: { basis: false }, sprache: 'fr', fingerabdruck: false },
      stand: { version: 2 },
    },
  });
  await migriereSpeicher();
  const nachher = alt.lokal.daten.get('einstellungen') as Record<string, unknown>;
  assert.equal(nachher.fingerabdruck, true, 'der Schutz wird einmalig angeschaltet');
  // Alles andere bleibt, wie der Nutzer es hatte.
  assert.deepEqual(nachher.listen, { basis: false });
  assert.equal(nachher.sprache, 'fr');
  assert.equal(nachher.aktiv, true);
  assert.deepEqual(alt.lokal.daten.get('stand'), { version: SPEICHER_VERSION });
});

test('Version 3 laeuft nur EINMAL: wer danach abschaltet, bleibt abgeschaltet', async () => {
  // Sonst waere aus der einmaligen Entscheidung eine taegliche geworden - und
  // der Schalter waere keiner mehr.
  const alt = installiereApi({
    lokal: {
      einstellungen: { aktiv: true, listen: {}, fingerabdruck: false },
      stand: { version: SPEICHER_VERSION },
    },
  });
  await migriereSpeicher();
  const nachher = alt.lokal.daten.get('einstellungen') as Record<string, unknown>;
  assert.equal(nachher.fingerabdruck, false, 'bei aktueller Version wird nichts mehr angefasst');
});

test('die Migration laesst ein eingeschaltetes AdSilence in Ruhe', async () => {
  const alt = installiereApi({
    lokal: { einstellungen: { aktiv: true, listen: {}, sprache: null, thema: 'system', zaehlerBadge: true } },
  });
  const vorher = JSON.stringify(alt.lokal.daten.get('einstellungen'));
  await migriereSpeicher();
  // Nichts zu tun heisst: `einstellungen` wird gar nicht erst geschrieben.
  assert.equal(JSON.stringify(alt.lokal.daten.get('einstellungen')), vorher);
});

test('ein zweiter Lauf der Migration aendert nichts mehr', async () => {
  const u = installiereApi();
  await migriereSpeicher();
  await u.lokal.set({ eigeneRegeln: '||b.example^' });
  const vorher = JSON.stringify([...u.lokal.daten.entries()].sort());
  await migriereSpeicher();
  assert.equal(JSON.stringify([...u.lokal.daten.entries()].sort()), vorher);
});

/**
 * BEFUND (Paket Kern/Bau, `src/gemeinsam/speicher.ts:93`): `migriereSpeicher()`
 * tut nichts, und zwar immer.
 *
 * Zeile 93 liest den Stand mit `liesLokal('stand')`, und genau diese
 * Funktion setzt fuer einen FEHLENDEN Schluessel die Vorgabe ein, also
 * `{ version: SPEICHER_VERSION }`. Zeile 94 liest daraus die aktuelle
 * Version, Zeile 95 steigt aus. Der Zweig darunter („Version 0 heisst nie
 * geschrieben") ist unerreichbar.
 *
 * Gemessen auf leerem Speicher: `liesLokal('stand')` → `{ version: 1 }`,
 * danach `storage.local` unveraendert leer. Erwartet nach dem Kommentar der
 * Funktion: alle Vorgaben angelegt, `stand` geschrieben.
 *
 * Heute faellt das nicht auf, weil jeder Lesezugriff die Vorgaben selbst
 * einsetzt. Es faellt beim naechsten Umzug auf: Steigt SPEICHER_VERSION auf
 * 2, liest ein alter Speicher (der `stand` nie geschrieben hat) wieder die
 * Vorgabe `{ version: 2 }` und ueberspringt den Umzugsblock, auf jeder
 * bereits ausgelieferten Installation.
 *
 * BEHOBEN beim Zusammenfuehren: `migriereSpeicher()` liest `stand` jetzt roh
 * ueber `api.storage.local.get(['stand'])`, sieht damit wirklich 0 und legt
 * die Vorgaben an. Die beiden Pruefungen sind seither scharf und nicht mehr
 * `todo`.
 */
test(
  'eine frische Installation bekommt alle Vorgaben und die aktuelle Version',
  async () => {
    const frisch = installiereApi();
    await migriereSpeicher();
    assert.deepEqual(frisch.lokal.daten.get('stand'), { version: SPEICHER_VERSION });
    for (const schluessel of Object.keys(LOKAL_VORGABE)) {
      assert.ok(frisch.lokal.daten.has(schluessel), `${schluessel} fehlt nach der Migration`);
    }
  },
);

test(
  'ein Speicher ohne `stand` bekommt die fehlenden Vorgaben nachgetragen',
  async () => {
    const alt = installiereApi({ lokal: { eigeneRegeln: '||a.example^' } });
    await migriereSpeicher();
    assert.deepEqual(alt.lokal.daten.get('sites'), {});
    assert.deepEqual(alt.lokal.daten.get('stand'), { version: SPEICHER_VERSION });
  },
);

test('stand.version steht auf 3; wer sie hebt, braucht einen Umzugsblock', () => {
  // Die Zahl haengt an `migriereSpeicher()`. Steigt sie ohne zusaetzlichen
  // `if (version < n)`-Block, laeuft der naechste Umzug ins Leere.
  // 1 -> 2 am 07.09.2026: `aktiv` zurueck auf true (siehe oben).
  // 2 -> 3 am 08.09.2026: `fingerabdruck` einmalig auf true.
  assert.equal(SPEICHER_VERSION, 3);
  assert.deepEqual(LOKAL_VORGABE.stand, { version: SPEICHER_VERSION });
});
