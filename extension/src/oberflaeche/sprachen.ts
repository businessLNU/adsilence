/**
 * Eigenname und Schreibrichtung je Sprachcode — ein NAMENSVERZEICHNIS.
 *
 * ── Was diese Liste ist und was sie nicht entscheidet ─────────────────────
 * Sie sagt nicht, welche Sprachen die Erweiterung anbietet. Das entscheidet
 * der Ordner `i18n/`: `verfuegbareSprachen` in `i18n.ts` fuehrt die Codes, fuer
 * die wirklich ein Katalog geladen ist, und `Einstellungen.tsx` filtert die
 * Auswahl damit. Eine Sprache anzubieten, deren Texte fehlen, hiesse
 * japanische Beschriftung und englischer Inhalt.
 *
 * Deshalb stehen hier MEHR Codes als die Erweiterung Sprachen hat, und das ist
 * kein Versehen: `spracheName()` beschriftet auch die REGIONALEN FILTERLISTEN
 * (`listen/quellen.json`). Werbung in Russland kommt von anderen Servern als
 * Werbung in Deutschland — die russische Liste blockt dort, ganz gleich in
 * welcher Sprache jemand die Oberflaeche liest. Ohne den Namen stuende in den
 * Einstellungen „ru" statt „Русский".
 *
 * ── Gestrichen wurden die KATALOGE, nicht die Namen ───────────────────────
 * Am 07.09.2026 lieferte die Erweiterung zwanzig Sprachkataloge, waehrend die
 * Website zehn fuehrte. Auf Ansage angeglichen: Die zehn Kataloge in `i18n/`
 * sind weg (sie stehen in der Versionsgeschichte, `git log -- extension/i18n/`),
 * die Namen hier bleiben. Wer sie hier mitloeschte, nahm den regionalen
 * Listen ihre Beschriftung — ein Test faengt genau das ab.
 */
export type SpracheEintrag = { code: string; name: string; dir: 'ltr' | 'rtl' };

export const SPRACHEN: readonly SpracheEintrag[] = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'zh', name: '中文', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'pt', name: 'Português', dir: 'ltr' },
  { code: 'ru', name: 'Русский', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'ja', name: '日本語', dir: 'ltr' },
  { code: 'it', name: 'Italiano', dir: 'ltr' },
  { code: 'ko', name: '한국어', dir: 'ltr' },
  { code: 'tr', name: 'Türkçe', dir: 'ltr' },
  { code: 'fa', name: 'فارسی', dir: 'rtl' },
  { code: 'nl', name: 'Nederlands', dir: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'pl', name: 'Polski', dir: 'ltr' },
  { code: 'vi', name: 'Tiếng Việt', dir: 'ltr' },
  { code: 'th', name: 'ไทย', dir: 'ltr' },
  { code: 'sv', name: 'Svenska', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
];

export function spracheName(code: string): string {
  return SPRACHEN.find((s) => s.code === code)?.name ?? code;
}
