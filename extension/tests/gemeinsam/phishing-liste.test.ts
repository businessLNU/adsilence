/**
 * Die Markenliste IM PAKET gegen echte Adressen der Marken.
 *
 * `phishing.test.ts` prueft die Regeln mit einer kleinen eigenen Liste. Hier
 * steht die Liste, die ausgeliefert wird – denn an ihr ist es passiert:
 * GEMESSEN am 07.10.2026 warnten 69 von 83 echten Adressen „Vorsicht, diese
 * Adresse taeuscht", gemeldet an `gemini.google` („Die echte ist
 * google.com"). Dazu `google.fr`, `amazon.it`, `paypal.me`, `zalando.at` und
 * jede regionale Sparkasse und Volksbank. Eine Warnung auf der echten Seite
 * verunsichert Kunden und macht jede spaetere Warnung unglaubwuerdig.
 *
 * Beide Richtungen stehen hier: Die echten Adressen schweigen, die
 * Faelschungen warnen weiter – sonst waere „0 Fehlalarme" mit einer leeren
 * Liste zu haben.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pruefeHost, type Marke } from '../../src/gemeinsam/phishing.ts';

const MARKEN = JSON.parse(
  readFileSync(new URL('../../phishing/marken.json', import.meta.url), 'utf8'),
) as Marke[];

const ECHT: Record<string, string[]> = {
  'Google, eigene Endung .google': ['gemini.google', 'blog.google', 'about.google', 'store.google', 'safety.google'],
  'Google, Laender und Dienste': [
    'google.fr', 'google.it', 'google.es', 'google.at', 'google.ch', 'google.co.uk', 'google.nl', 'google.pl',
    'google.com.tr', 'google.co.jp', 'google.dev', 'goo.gle', 'youtu.be', 'googleusercontent.com',
    'google-analytics.com', 'withgoogle.com', 'gemini.google.com',
  ],
  Amazon: [
    'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.ca', 'amazon.co.jp',
    'amazon.com.tr', 'amazon.in', 'amazon.jobs', 'amazon.science', 'aboutamazon.de', 'amazon-adsystem.com',
  ],
  Apple: ['apple.news', 'apple-cloudkit.com', 'icloud-content.com'],
  PayPal: ['paypal.me', 'paypal.fr', 'paypal.it', 'paypal.es', 'paypal-community.com'],
  'Sparkasse, einzelne Haeuser': [
    'sparkasse-hannover.de', 'sparkasse-bremen.de', 'sparkasse-aachen.de', 'sparkasse-leipzig.de',
    'berliner-sparkasse.de', 'frankfurter-sparkasse.de', 'haspa.de',
  ],
  'Volksbank, einzelne Haeuser': ['volksbank-mittelhessen.de', 'volksbank-stuttgart.de', 'berliner-volksbank.de'],
  Zalando: ['zalando.at', 'zalando.ch', 'zalando.fr', 'zalando.nl', 'zalando.it', 'zalando.co.uk', 'zalando.pl', 'zalando-lounge.de'],
  Airbnb: ['airbnb.at', 'airbnb.ch', 'airbnb.fr', 'airbnb.co.uk'],
  'MediaMarkt, Saturn': ['mediamarkt.at', 'mediamarkt.ch', 'mediamarkt.nl', 'saturn.at'],
  Vodafone: ['vodafone.co.uk', 'vodafone.es', 'vodafone.it'],
  Sonstige: [
    'revolut.me', 'spotify.link', 'commerzbank.com', 'lufthansa-technik.com', 'lufthansa-cargo.com',
    'bahn.com', 'ebay.at', 'wa.me', 'instagr.am', 'lnkd.in',
  ],
};

for (const [gruppe, hosts] of Object.entries(ECHT)) {
  test(`echte Adressen warnen nicht: ${gruppe}`, () => {
    const falsch = hosts.filter((h) => pruefeHost(h, MARKEN) !== null);
    assert.deepEqual(falsch, [], `Diese echten Adressen bekaemen die Warnung „taeuscht": ${falsch.join(', ')}`);
  });
}

test('die Faelschungen warnen weiterhin – auch die, die einer echten Adresse nahe kommen', () => {
  const faelschungen = [
    'paypal.com.sicherheit-pruefung.xyz', 'amazon-kundenservice.tk', 'paypaI.com', 'pаypal.com', 'payypal.com',
    'rnicrosoft.com', 'sparkasse-sicherheit.com', 'login-sparkasse.de.example.net', 'amazon.shop', 'google-login.xyz',
    // Laenderendung, aber frei vergeben: bleibt verdaechtig.
    'paypal.tk',
    // Haus-Form, aber mit Koederwort oder fremder Endung: bleibt verdaechtig.
    'sparkasse-verifizierung.de', 'volksbank-pushtan.de', 'sparkasse-login.de', 'sparkasse-hannover.com',
    'gooogle.com', 'paypaI.fr',
  ];
  const still = faelschungen.filter((h) => pruefeHost(h, MARKEN) === null);
  assert.deepEqual(still, [], `Diese Faelschungen loesen keine Warnung mehr aus: ${still.join(', ')}`);
});
