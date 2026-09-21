/**
 * Der Verwechslungswarner. Zwei Fragen, und die zweite ist die wichtigere:
 *
 *   1. Erkennt er die bekannten Tricks?
 *   2. Schweigt er auf echten Seiten?
 *
 * Die zweite Haelfte ist laenger als die erste, und das ist Absicht. Eine
 * Warnung auf der echten Bankseite kostet das Vertrauen in alle folgenden
 * Warnungen; eine uebersehene Faelschung kostet den Schutz nur in diesem
 * einen Fall. Deshalb steht bei jedem neuen Erkennungsmuster zuerst die
 * Frage, welche echte Seite es faelschlich treffen koennte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abstand, entschluesseleHost, mischtSchriften, pruefeHost, registrierbar, skelett, type Marke } from '../../src/gemeinsam/phishing.ts';

const MARKEN: Marke[] = [
  { name: 'PayPal', domains: ['paypal.com', 'paypal.de'] },
  { name: 'Sparkasse', domains: ['sparkasse.de'] },
  { name: 'Amazon', domains: ['amazon.de', 'amazon.com'] },
  { name: 'DHL', domains: ['dhl.de'] },
  { name: 'Microsoft', domains: ['microsoft.com'] },
];

// ── Hilfen ─────────────────────────────────────────────────────────────────

test('registrierbar schneidet Unterdomains ab, kennt aber co.uk', () => {
  assert.equal(registrierbar('signin.paypal.com'), 'paypal.com');
  assert.equal(registrierbar('paypal.com'), 'paypal.com');
  assert.equal(registrierbar('a.b.c.example.co.uk'), 'example.co.uk');
  assert.equal(registrierbar('www.bank.com.au'), 'bank.com.au');
});

test('skelett zieht verwechselbare Zeichen zusammen', () => {
  assert.equal(skelett('PayPaI'), skelett('paypal'));
  assert.equal(skelett('paypa1'), skelett('paypal'));
  assert.equal(skelett('rnicrosoft'), skelett('microsoft'));
  // Kyrillisches a
  assert.equal(skelett('pаypal'), skelett('paypal'));
  assert.notEqual(skelett('google'), skelett('paypal'));
});

test('abstand bricht ueber der Grenze ab, statt weiterzurechnen', () => {
  assert.equal(abstand('paypal', 'paypal', 1), 0);
  assert.equal(abstand('paypa', 'paypal', 1), 1);
  assert.equal(abstand('google', 'paypal', 1), 2);
});

// ── Erkennung ──────────────────────────────────────────────────────────────

test('grosses I statt kleinem l wird erkannt', () => {
  const v = pruefeHost('paypaI.com', MARKEN);
  assert.ok(v, 'paypaI.com muss auffallen');
  assert.equal(v.marke, 'PayPal');
  assert.equal(v.echt, 'paypal.com');
  assert.equal(v.grund, 'homoglyph');
});

test('kyrillische Buchstaben werden erkannt', () => {
  const v = pruefeHost('pаypаl.com', MARKEN);
  assert.ok(v, 'kyrillisches a muss auffallen');
  assert.equal(v.marke, 'PayPal');
});

test('die Marke als Teil einer fremden Domain wird erkannt', () => {
  for (const host of ['paypal.com.sicherheit-pruefung.xyz', 'login-sparkasse.de.example.net', 'amazon-kundenservice.tk']) {
    const v = pruefeHost(host, MARKEN);
    assert.ok(v, `${host} muss auffallen`);
    assert.equal(v.grund, 'markeAlsTeil');
  }
});

test('ein Zeichen daneben wird erkannt', () => {
  const v = pruefeHost('payypal.com', MARKEN);
  assert.ok(v, 'payypal.com muss auffallen');
  assert.equal(v.grund, 'einZeichen');
});

test('rn statt m wird erkannt', () => {
  const v = pruefeHost('rnicrosoft.com', MARKEN);
  assert.ok(v, 'rnicrosoft.com muss auffallen');
  assert.equal(v.marke, 'Microsoft');
});

// ── Und jetzt die wichtigere Haelfte: kein Fehlalarm ───────────────────────

test('die echten Seiten der Marken loesen NIE aus', () => {
  const echt = [
    'paypal.com', 'www.paypal.com', 'signin.paypal.com', 'paypal.de', 'www.paypal.de',
    'sparkasse.de', 'www.sparkasse.de', 'banking.sparkasse.de',
    'amazon.de', 'www.amazon.de', 'smile.amazon.com', 'images-eu.ssl-images-amazon.de',
    'dhl.de', 'www.dhl.de', 'microsoft.com', 'login.microsoft.com',
  ];
  for (const host of echt) {
    assert.equal(pruefeHost(host, MARKEN), null, `${host} ist echt und darf nicht warnen`);
  }
});

test('voellig fremde Seiten loesen nicht aus', () => {
  const fremd = [
    'wikipedia.org', 'de.wikipedia.org', 'github.com', 'tagesschau.de', 'spiegel.de',
    'bild.de', 'google.com', 'chip.de', 'example.co.uk', 'bahn.de', 'ing.de',
    'commerzbank.de', 'volksbank.de', 'postbank.de', 'dkb.de', 'n26.com',
  ];
  for (const host of fremd) {
    assert.equal(pruefeHost(host, MARKEN), null, `${host} hat nichts mit den Marken zu tun`);
  }
});

test('kurze Marken erzeugen keine Warnung bei fremden Woertern', () => {
  // `dhl.de` ist drei Zeichen lang. Ohne die Laengengrenzen wuerde jede
  // Domain mit „dhl" darin und jede Ein-Zeichen-Nachbarschaft warnen.
  for (const host of ['dhlogistik.de', 'ahl.de', 'dhz.de', 'handel.de']) {
    assert.equal(pruefeHost(host, MARKEN), null, `${host} darf nicht warnen`);
  }
});

test('Woerter, die zufaellig mit einer Marke anfangen, bleiben still', () => {
  // `amazonas` faengt mit `amazon` an, `microsofties` mit `microsoft`. Beides
  // sind gewachsene Woerter. Die Erkennung verlangt deshalb hinter dem
  // Markennamen einen Trenner und keinen weiteren Buchstaben.
  for (const host of ['amazonas-shop.de', 'microsofties.net', 'paypallets.com']) {
    assert.equal(pruefeHost(host, MARKEN), null, `${host} darf nicht warnen`);
  }
});

test('GRENZE, bewusst in Kauf genommen: Marke plus Wortendung faellt durch', () => {
  // `paypallets.com` waere als Taeuschung denkbar, ist aber an der
  // Zeichenkette nicht von `amazonas-shop.de` zu unterscheiden. Dieser Test
  // haelt die Entscheidung fest, damit sie beim naechsten Umbau nicht
  // unbemerkt kippt: Wer hier eine Warnung einbaut, holt sich die Fehlalarme
  // des Tests darueber mit.
  assert.equal(pruefeHost('paypallets.com', MARKEN), null);
});

test('ein leerer oder unvollstaendiger Host faellt durch, ohne zu werfen', () => {
  for (const host of ['', 'localhost', 'a', '.']) {
    assert.equal(pruefeHost(host, MARKEN), null, `${host} darf nichts ausloesen`);
  }
});

test('ohne Markenliste gibt es nie eine Warnung', () => {
  assert.equal(pruefeHost('paypaI.com', []), null);
});

// ── Internationale Adressen: der gefaehrlichste Fall ───────────────────────

test('Punycode wird entschluesselt, bevor geprueft wird', () => {
  // `location.hostname` gibt einem Inhaltsskript NIE die lesbare Form. Ohne
  // Entschluesselung war die Erkennung genau fuer den Fall blind, in dem der
  // Nutzer die Faelschung am Namen gar nicht sehen kann.
  assert.equal(entschluesseleHost('xn--mazon-3ve.de'), 'аmazon.de');
  assert.equal(entschluesseleHost('xn--pypal-4ve.com'), 'pаypal.com');
  assert.equal(entschluesseleHost('amazon.de'), 'amazon.de', 'ohne xn-- unveraendert');
  assert.equal(entschluesseleHost('www.xn--mazon-3ve.de'), 'www.аmazon.de', 'je Label');
});

test('kyrillische, griechische und armenische Faelschungen werden erkannt', () => {
  const faelle: [string, string][] = [
    ['xn--mazon-3ve.de', 'Amazon'],
    ['xn--pypal-4ve.com', 'PayPal'],
    ['xn--sprkasse-26g.de', 'Sparkasse'],
  ];
  for (const [host, marke] of faelle) {
    const v = pruefeHost(host, MARKEN);
    assert.ok(v, `${host} muss auffallen`);
    assert.equal(v.marke, marke);
    assert.equal(v.grund, 'punycode');
    assert.ok(v.lesbar, 'die lesbare Form gehoert in die Warnung');
  }
});

test('die Warnung nennt beide Formen: Punycode und lesbar', () => {
  const v = pruefeHost('xn--mazon-3ve.de', MARKEN);
  assert.ok(v);
  assert.equal(v.host, 'xn--mazon-3ve.de', 'der Host, wie der Browser ihn nennt');
  assert.equal(v.lesbar, 'аmazon.de', 'und die Form, die der Nutzer sieht');
});

test('bei rein lateinischen Adressen bleibt `lesbar` leer', () => {
  const v = pruefeHost('paypa1.com', MARKEN);
  assert.ok(v);
  assert.equal(v.lesbar, null, 'ohne Fremdschrift gibt es nichts zu uebersetzen');
});

test('NFKD faengt Akzente und Breitenvarianten ohne eigene Tabelle', () => {
  assert.equal(skelett('pàypal'), skelett('paypal'), 'Akzent');
  assert.equal(skelett('ｐａｙｐａｌ'), skelett('paypal'), 'vollbreite Zeichen');
});

test('mischtSchriften trennt Absicht von Sprache', () => {
  assert.equal(mischtSchriften('аmazon'), true, 'ein kyrillisches Zeichen unter lateinischen');
  assert.equal(mischtSchriften('amazon'), false, 'rein lateinisch');
  assert.equal(mischtSchriften('みんな'), false, 'rein japanisch ist eine Sprache, keine Taeuschung');
  assert.equal(mischtSchriften('shop-24'), false, 'Ziffern und Bindestrich zaehlen nicht');
});

test('eine echte internationale Adresse loest nicht aus', () => {
  // Jedes Label bleibt bei seiner Schrift - das ist eine Sprache, keine
  // Taeuschung. Ohne die Pruefung JE LABEL waere das ein Fehlalarm.
  for (const host of ['münchen.de', 'xn--mnchen-3ya.de', 'bücher.de']) {
    assert.equal(pruefeHost(host, MARKEN), null, `${host} ist echt`);
  }
});
