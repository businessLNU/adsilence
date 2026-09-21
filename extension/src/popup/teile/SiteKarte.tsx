/**
 * EINE Karte fuer beide Schalter: oben der Host mit „Auf dieser Seite
 * blockieren" und dem Zaehler, unter einer Trennlinie „AdSilence aktiv".
 *
 * Der Schalter zeigt `!erlaubt`: „an" heisst blocken. Ohne Webseite
 * (Neuer Tab, chrome://) gibt es nichts zu schalten. Bei global aus ist
 * der Seitenschalter ebenfalls aus; sonst saehe es aus, als bloeckten wir.
 *
 * ── Ein Schalter, nicht zwei ───────────────────────────────────────────────
 * Hier standen einmal zwei: „Auf dieser Seite blockieren" und darunter
 * „AdSilence aktiv". Sie sahen einander zu aehnlich - je eine Zeile Text und
 * ein Schalter rechts -, und wer das Popup hundertmal am Tag oeffnet, musste
 * jedes Mal lesen, welcher welcher ist. Geblieben ist der, den man taeglich
 * braucht: die Ausnahme fuer DIESE Seite. Das globale Abschalten steht in den
 * Optionen unter Einstellungen; es ist eine seltene Entscheidung und gehoert
 * nicht neben eine haeufige.
 */
import { useState, type ReactNode } from 'react';
import type { TabZustand } from '../../gemeinsam/typen.ts';
import { SAMMELREGEL } from '../../gemeinsam/konstanten.ts';
import { Karte } from '../../oberflaeche/Karte.tsx';
import { Schalter } from '../../oberflaeche/Schalter.tsx';
import { formatiereZahl, hatText, t } from '../../oberflaeche/i18n.ts';
import { schluesselAusId } from '../../oberflaeche/i18n-kern.ts';

/**
 * Was in einer Zeile der Aufschluesselung steht.
 *
 * Meist die Domain, die die Regel sperrt. Deckt die Regel eine ganze Liste
 * von Domains ab, weiss niemand, welche davon griff - dann steht dort ein
 * Satz, der genau das sagt, statt einer geratenen Domain (siehe
 * `SAMMELREGEL`).
 */
function regelName(was: string): string {
  return was === SAMMELREGEL ? t('popup.site.sammelregel') : was;
}

/** Der uebersetzte Name einer Liste, sonst ihre Kennung. */
function listenName(id: string): string {
  const schluessel = `optionen.listen.${schluesselAusId(id)}.name`;
  return hatText(schluessel) ? t(schluessel) : id;
}

export function SiteKarte({
  tab,
  aktiv,
  onWechsel,
  beschaeftigt,
  premium = false,
}: {
  tab: TabZustand | null;
  aktiv: boolean;
  onWechsel: (blocken: boolean) => void;
  beschaeftigt: boolean;
  /**
   * Bei Premium bekommt die Karte eine Fassung in der Markenfarbe -- dasselbe
   * Mittel wie beim gebuchten Tarif auf der Website (`.karte.gebucht`):
   * `outline` mit Abstand, keine andere Fuellfarbe. Farbe waere hier eine
   * zweite Bedeutung neben „das ist der Schalter".
   */
  premium?: boolean;
}) {
  const blockt = Boolean(tab) && aktiv && !tab!.erlaubt;
  const [offen, setzeOffen] = useState(false);
  // Details gibt es nur, wenn wirklich etwas aufzuschluesseln ist.
  const details = blockt ? (tab?.jeListe ?? []) : [];

  let zaehler: ReactNode;
  if (!tab) zaehler = t('popup.site.keineSeite');
  else if (!aktiv) zaehler = t('popup.aktivAus');
  else if (tab.erlaubt) zaehler = t('popup.site.erlaubt');
  // 'amSymbol': keine Zeile. Die Zahl steht sichtbar auf dem Symbol, zwei
  // Zentimeter darueber; ein Satz, der das erklaert, waere laenger als der
  // Blick hinauf.
  else if (tab.blockiert === 'amSymbol') zaehler = null;
  else if (tab.blockiert === null) zaehler = t('popup.site.zaehlerFehlt');
  else if (tab.blockiert === 0) zaehler = t('popup.site.blockiertKeine');
  else if (tab.blockiert === 1) zaehler = t('popup.site.blockiertEine');
  else zaehler = t('popup.site.blockiert', { anzahl: formatiereZahl(tab.blockiert) });

  return (
    <Karte className={premium ? 'site site--premium' : 'site'} aria-labelledby="site-titel">
      <div className="site__kopf">
        <div className="site__host" title={tab?.host ?? undefined}>
          {tab?.host ?? t('popup.site.keineSeite')}
        </div>
      </div>
      <div className="site__zeile">
        <div className="wachsend">
          <div id="site-titel" className="schalterzeile__titel">
            {t('popup.site.titel')}
          </div>
          {zaehler === null ? null : (
            <div className="site__zaehler zahl" aria-live="polite">
              {zaehler}
              {details.length > 0 ? (
                <>
                  {' '}
                  <button type="button" className="site__mehr" aria-expanded={offen} onClick={() => setzeOffen((o) => !o)}>
                    {offen ? t('popup.site.wenigerDetails') : t('popup.site.mehrDetails')}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
        <Schalter gross an={blockt} disabled={!tab || !aktiv || beschaeftigt} onWechsel={onWechsel} aria-labelledby="site-titel" />
      </div>
      {offen && details.length > 0 ? (
        <ul className="site__listen">
          {details.map((d) => (
            <li key={d.id}>
              <div className="site__listenkopf">
                <span className="wachsend abschneiden">{listenName(d.id)}</span>
                <span className="zahl">{formatiereZahl(d.anzahl)}</span>
              </div>
              {/*
                Was innerhalb der Liste griff: die Domain aus dem Regelmuster.
                Hoechstens acht je Liste - auf einer Nachrichtenseite greifen
                schnell dreissig verschiedene Regeln, und eine Liste, die das
                Popup auf die dreifache Hoehe zieht, liest ohnehin niemand.
                Was darueber hinausgeht, steht als Rest am Ende, damit die
                Summe stimmt.
              */}
              {d.regeln.length > 0 ? (
                <ul className="site__regeln">
                  {d.regeln.slice(0, 8).map((r) => (
                    <li key={r.was}>
                      <span className="wachsend abschneiden" title={regelName(r.was)}>
                        {regelName(r.was)}
                      </span>
                      <span className="zahl">{formatiereZahl(r.anzahl)}</span>
                    </li>
                  ))}
                  {d.regeln.length > 8 ? (
                    <li className="site__rest">
                      <span className="wachsend">
                        {t('popup.site.weitere', { anzahl: formatiereZahl(d.regeln.length - 8) })}
                      </span>
                      <span className="zahl">{formatiereZahl(d.regeln.slice(8).reduce((s, r) => s + r.anzahl, 0))}</span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Karte>
  );
}
