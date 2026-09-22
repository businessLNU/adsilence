/**
 * Der Weg zu Premium: ein Knopf, der die PREISSEITE im Browser oeffnet.
 *
 * ── Warum nicht im Popup selbst ───────────────────────────────────────────
 * Hier stand bis zum 08.09.2026 ein Fenster mit Tarif, Zahlweise,
 * Zustimmungshaken und Kaufknopf. Es funktionierte, und es war trotzdem
 * falsch: Das Popup einer Erweiterung ist 360 Pixel breit und schliesst sich,
 * sobald der Nutzer danebenklickt. Eine Kaufentscheidung -- Preis lesen,
 * Zahlweise vergleichen, Rechtstexte oeffnen, Zahlungsmittel eingeben --
 * gehoert nicht in ein Fenster, das beim Wegsehen verschwindet.
 *
 * Auf Ansage vom 08.09.2026: Ein Klick fuehrt auf die Website, und dort wird
 * gekauft. Dieselbe Seite, die auch ein Besucher sieht, mit demselben Preis
 * aus derselben Quelle.
 *
 * ── Warum die neutrale Adresse und `?lang=` ───────────────────────────────
 * Die Preisseite hat je Sprache einen eigenen Slug (`/de/preise`,
 * `/es/precios`). Die Tabelle dafuer steht im Backend, nicht hier -- sie
 * hierher zu kopieren hiesse, eine zweite Fassung zu pflegen, die beim
 * naechsten Sprachzuwachs veraltet.
 *
 * Die NEUTRALE Adresse `/preise` gibt es immer, sie leitet nicht um, und sie
 * ist das Ziel von `x-default`. Die Sprache kommt als `?lang=` dazu: Der
 * Server wertet sie aus (Pfad → `?lang=` → Cookie → Accept-Language), und
 * damit sieht der Nutzer die Seite in der Sprache, die er in der Erweiterung
 * eingestellt hat.
 *
 * `?von=erweiterung` sagt der Seite, woher der Besucher kommt -- ohne Konto,
 * ohne Kennung, ohne Cookie. Es ist die Auskunft, die eine spaetere eigene
 * Landingpage braucht, und heute schon lesbar.
 */
import { Knopf } from './Knopf.tsx';
import { sprache, t } from './i18n.ts';
import { oeffneTab, UMGEBUNG } from './laufzeit.ts';

/** Die Adresse der Preisseite, in der Sprache der Erweiterung. */
export function preisseite(): string {
  const basis = UMGEBUNG.apiBasis.replace(/\/+$/, '');
  return `${basis}/preise?lang=${encodeURIComponent(sprache())}&von=erweiterung`;
}

/**
 * Darf diese Fassung ueberhaupt zum Kauf auffordern?
 *
 * ── Warum Safari hier anders ist ──────────────────────────────────────────
 * Richtlinie 3.1.1 der App-Store-Pruefung verbietet Knoepfe, Links und
 * Aufforderungen, die zu einem ANDEREN Kaufweg als dem In-App-Kauf fuehren,
 * wenn die Funktion in der App freigeschaltet wird. Ein Knopf „Premium
 * holen", der die eigene Preisseite oeffnet, ist genau das — und der
 * haeufigste Ablehnungsgrund ueberhaupt.
 *
 * Erlaubt bleibt das ANMELDEN mit einem anderswo gekauften Konto. Verboten
 * ist nur, den Kauf in der App zu bewerben oder zu verlinken. Deshalb faellt
 * hier der Knopf weg und nicht die Kontoverwaltung.
 *
 * Bei Chrome und Firefox ist derselbe Knopf voellig normal; die Unterscheidung
 * gehoert also an das ZIEL und nicht in eine Einstellung.
 */
export const KAUFWEG_ERLAUBT = UMGEBUNG.browser !== 'safari';

export function PremiumWahl({ breit }: { onFehler?: (code: string) => void; breit?: boolean }) {
  if (!KAUFWEG_ERLAUBT) return null;
  return (
    <Knopf art="primaer" breit={breit} onClick={() => void oeffneTab(preisseite())}>
      {t('gemeinsam.premiumHolen')}
    </Knopf>
  );
}
