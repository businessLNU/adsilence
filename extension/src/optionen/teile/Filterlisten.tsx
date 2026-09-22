/**
 * Filterlisten: je Liste Name, Herkunft, Regelanzahl, Schalter. Premium-
 * Listen tragen ein Schloss und einen Satz, solange kein Premium da ist;
 * der Schalter bleibt dann aus und gesperrt, statt beim Druecken zu klagen.
 */
import { useEffect, useState } from 'react';
import type React from 'react';
import type { Einstellungen as EinstellungenForm, ListenEintrag, Zustand } from '../../gemeinsam/typen.ts';
import { Hinweis, fehlerText } from '../../oberflaeche/Hinweis.tsx';
import { preisseite } from '../../oberflaeche/PremiumWahl.tsx';
import { Schalter } from '../../oberflaeche/Schalter.tsx';
import { Info, Schloss } from '../../oberflaeche/Symbole.tsx';
import { formatiereDatum, formatiereZahl, hatText, t } from '../../oberflaeche/i18n.ts';
import { spracheName } from '../../oberflaeche/sprachen.ts';
import { schluesselAusId } from '../../oberflaeche/i18n-kern.ts';
import {
  NachrichtFehler,
  beiSpeicherAenderung,
  leseSpeicher,
  oeffneTab,
  schreibeSpeicher,
  sende,
} from '../../oberflaeche/laufzeit.ts';
import { istUeberfaellig } from '../../hintergrund/listenpflege.ts';
import { BROWSER, LISTENPFLEGE_VERALTET_MS } from '../../gemeinsam/konstanten.ts';
import { WERKZEUGE } from '../../gemeinsam/cookies.ts';

/**
 * Der Name einer Liste.
 *
 * Bei einer REGIONALEN Liste ist es der Name ihrer Sprache in deren eigener
 * Schreibweise: „Deutsch", „Français", „日本語". Das ist die Auskunft, die
 * jemand sucht, der eine Liste für seine Sprache will - und es erspart 18
 * Listen mal 20 Sprachen an Übersetzungen für Namen, die in `sprachen.ts`
 * längst stehen.
 */
function nameVon(l: ListenEintrag): string {
  if (l.sprache) return spracheName(l.sprache);
  const k = `optionen.listen.${schluesselAusId(l.id)}.name`;
  return hatText(k) ? t(k) : l.id;
}

/**
 * Der Nebentext einer Liste.
 *
 * ── Der Eigenname der Quelle steht hier NICHT ──────────────────────────────
 * Unter den regionalen Listen stand bis zum 07.09.2026 `l.name` - der
 * Eigenname der Quelle, also „EasyList Germany", „Liste FR", „YousList". Und
 * in den Nebentexten der uebrigen stand er vorangestellt: „uBlock filters
 * Quick fixes: kurzfristige Korrekturen …".
 *
 * Beides ist raus. Ein Name, den man abtippen und suchen kann, fuehrt vom
 * Produkt weg: Wer „EasyList" liest, findet in zwei Klicks die Rohdatei und
 * einen Blocker, der sie auch fuehrt. Der Nebentext sagt jetzt, was die Liste
 * TUT - das ist ohnehin die Auskunft, die jemand vor einem Schalter braucht.
 *
 * Der RUECKFALL ist deshalb `l.id` und nicht mehr `l.name`: Bei einer Liste
 * ohne Katalogtext stuende sonst genau der Eigenname da, den wir gerade
 * ueberall entfernt haben. Er greift praktisch nie - `tests/oberflaeche/
 * i18n.test.ts` besteht darauf, dass jede Liste aus `quellen.json` ihren
 * `.name` und ihren `.text` in `de.json` hat.
 *
 * Woher die Listen kommen, steht weiterhin im Katalog (32) und in
 * `listen/quellen.json`. Verschwiegen wird nichts, es steht nur nicht mehr
 * auf einem Bildschirm, auf dem es niemandem hilft.
 */
function textVon(l: ListenEintrag): string {
  // Regionale Listen haben KEINEN Nebentext. Ihr Name ist die Sprache, und
  // mehr unterscheidet sie fuer den Leser nicht: Achtzehn Zeilen, unter jeder
  // derselbe Satz, ist Rauschen - der Blick liest ihn einmal und danach nie
  // wieder, waehrend er jede Zeile hoeher macht. (Sie erscheinen ohnehin nur
  // in `SprachListen.tsx`; `einzeln` unten filtert `!l.sprache`.)
  if (l.sprache) return '';
  const k = `optionen.listen.${schluesselAusId(l.id)}.text`;
  return hatText(k) ? t(k) : l.id;
}

/**
 * Die Listen, die einzeln stehen bleiben, obwohl sie ab Werk an sind.
 *
 * Zurzeit keine. `cookies` stand hier bis zum 05.09.2026 — die Zeile ist
 * weggefallen, weil zwei Zeilen derselben Liste dasselbe versprachen: Die
 * Liste blendet Cookie-Banner AUS, und „Cookie-Fenster beantworten" weiter
 * unten klickt sie WEG. Wer beides untereinander liest, haelt eines davon
 * fuer ueberfluessig.
 *
 * Die Liste laeuft unveraendert weiter — sie ist jetzt Teil von „Blocker
 * Lite". Sie hier herauszunehmen und den Schalter wegzulassen waere etwas
 * anderes gewesen: Dann waeren Cookie-Banner unbemerkt zurueckgekommen.
 *
 * Ihr Name bleibt in den Sprachdateien: `popup/teile/SiteKarte.tsx` nennt die
 * greifenden Listen einer Seite beim Namen und braucht ihn weiterhin.
 */
const EINZELN = new Set<string>([]);

/**
 * Ein Regler, der nur so AUSSIEHT.
 *
 * Eine gesperrte Zeile ist als Ganzes ein Knopf, der das Kauffenster oeffnet
 * (`kaufProps`). Ein echter `<button role="switch">` darin waere ein zweites
 * Bedienelement im ersten: Die Tabulatortaste haelte zweimal an derselben
 * Zeile, und eine Vorleseanwendung nennte einen Schalter, der nichts
 * schaltet. `aria-hidden`, weil das Schloss daneben dieselbe Auskunft gibt -
 * nur richtig.
 */
function SchalterAttrappe() {
  return (
    <span className="schalter schalter--attrappe" aria-hidden="true">
      <span className="schalter__bahn">
        <span className="schalter__knopf" />
      </span>
    </span>
  );
}

/**
 * Was eine gesperrte Zeile zum Klickziel macht - Regler eingeschlossen, denn
 * der Regler liegt IN der Zeile.
 *
 * Frueher war die Zeile stumm und der Schalter `disabled`: Wer darauf
 * drueckte, bekam nichts, nicht einmal eine Erklaerung. Jetzt fuehrt jeder
 * Druck an derselben Stelle zur PREISSEITE im Browser -- nicht in ein
 * Fenster in der Erweiterung. Eine Kaufentscheidung gehoert auf eine Seite,
 * die stehen bleibt (Begruendung an `PremiumWahl`).
 *
 * `role="button"` statt eines echten `<button>`: In der Zeile stehen `<div>`
 * und `<ul>`, und die duerfen in einem Knopf nicht stehen. Tastatur und Name
 * kommen deshalb von Hand - Leertaste und Enter wie bei jedem Knopf.
 */
function kaufProps(gesperrt: boolean) {
  if (!gesperrt) return { className: 'liste__zeile' };
  const oeffne = () => void oeffneTab(preisseite());
  return {
    className: 'liste__zeile liste__zeile--kauf',
    role: 'button',
    tabIndex: 0,
    onClick: oeffne,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      oeffne();
    },
  } as const;
}

export function Filterlisten({ zustand }: { zustand: Zustand }) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [wartend, setWartend] = useState<string | null>(null);
  // Optimistisch: der Schalter springt sofort; der Zustand aus dem Speicher
  // ueberholt ihn gleich darauf und bestaetigt oder korrigiert.
  const [lokal, setLokal] = useState<Record<string, boolean>>({});
  const premium = zustand.lizenz.premium;

  // Zwei Gruppen: der Grundschutz als EIN Eintrag und die einzeln waehlbaren
  // Listen. Die Sprachlisten stehen seit dem 05.09.2026 unter „Einstellungen"
  // (`SprachListen.tsx`) — sie sind eine Auskunft ueber das eigene Umfeld,
  // keine Entscheidung ueber das Blocken.
  const grund = zustand.listen.filter((l) => !l.sprache && l.standard && !EINZELN.has(l.id));
  const einzeln = zustand.listen.filter((l) => !l.sprache && (!l.standard || EINZELN.has(l.id)));

  /*
   * Der Grundschutz ist an, wenn ALLE seine Listen an sind — nicht, wenn eine
   * es ist. Sonst zeigte der Schalter „an", waehrend die Haelfte aus waere,
   * und niemand kaeme an die Haelfte wieder heran: Die Einzelzeilen gibt es
   * hier ja nicht mehr.
   */
  const grundAn = grund.length > 0 && grund.every((l) => lokal[l.id] ?? l.aktiv);
  const grundWartet = grund.some((l) => wartend === l.id);

  async function schalteGrund(an: boolean) {
    setFehler(null);
    setWartend(grund[0]?.id ?? null);
    setLokal((a) => ({ ...a, ...Object.fromEntries(grund.map((l) => [l.id, an])) }));
    try {
      // Nacheinander und nicht `Promise.all`: Jede Nachricht schreibt denselben
      // Einstellungssatz zurueck. Parallel gewaenne die letzte Antwort, und die
      // Aenderungen der uebrigen waeren weg.
      for (const l of grund) await sende({ typ: 'liste.setzen', id: l.id, aktiv: an });
    } catch (e) {
      setLokal((a) => ({ ...a, ...Object.fromEntries(grund.map((l) => [l.id, !an])) }));
      setFehler(fehlerText(e instanceof NachrichtFehler ? e.code : undefined));
    } finally {
      setWartend(null);
    }
  }


  /*
   * Cookie-Antwort, Verwechslungswarner und Listenpflege wohnen seit dem
   * 05.09.2026 hier und nicht mehr unter „Einstellungen": Alle drei
   * bestimmen, WAS geblockt und beantwortet wird. Wer das aendern will, sucht
   * es dort, wo die Listen stehen.
   *
   * Sie schreiben direkt in den Speicher (`schreibeSpeicher`) und nicht ueber
   * eine Nachricht — der Vertrag kennt Nachrichten nur fuer `aktiv` und
   * `listen`. Vor jedem Schreiben wird frisch gelesen, damit ein Wert, den der
   * Hintergrund inzwischen gesetzt hat, nicht ueberschrieben wird.
   */
  const [e, setE] = useState<EinstellungenForm | null>(null);
  useEffect(() => {
    let lebt = true;
    void leseSpeicher('einstellungen')
      .then((sp) => lebt && setE(sp.einstellungen))
      .catch(() => lebt && setFehler(fehlerText('HINTERGRUND_FEHLT')));
    const ab = beiSpeicherAenderung((a) => {
      if (a.einstellungen) setE(a.einstellungen);
    });
    return () => {
      lebt = false;
      ab();
    };
  }, []);

  async function aendere(teil: Partial<EinstellungenForm>) {
    setFehler(null);
    setE((alt) => (alt ? { ...alt, ...teil } : alt));
    try {
      const { einstellungen } = await leseSpeicher('einstellungen');
      await schreibeSpeicher({ einstellungen: { ...einstellungen, ...teil } });
    } catch {
      setFehler(fehlerText('HINTERGRUND_FEHLT'));
    }
  }

  // Was der letzte Lauf ergeben hat, steht unter dem Schalter - sonst ist
  // „laeuft taeglich" eine Behauptung, die niemand nachpruefen kann.
  const [stand, setStand] = useState<{
    am: string;
    neu: number;
    uebergangen?: number;
    fehlend?: string[];
  } | null>(null);
  useEffect(() => {
    void leseSpeicher('listenPflegeStand').then((sp) => setStand(sp.listenPflegeStand ?? null));
    // Ohne diesen Abonnenten stand die Zeile still, waehrend im Hintergrund
    // gepflegt wurde: Gelesen wurde nur beim Oeffnen der Seite und nach einem
    // Klick — und den Klick gibt es nicht mehr.
    return beiSpeicherAenderung((a) => {
      if (a.listenPflegeStand !== undefined) setStand(a.listenPflegeStand ?? null);
    });
  }, []);
  const veraltet = stand !== null && istUeberfaellig(stand.am, Date.now(), LISTENPFLEGE_VERALTET_MS);
  /*
   * Der Nebentext nennt drei Dinge, und die beiden letzten NUR, wenn sie
   * zutreffen: Ein Dauerhinweis wird zur Tapete.
   *
   * `uebergangen` und `fehlend` lagen bisher im Speicher, ohne dass sie
   * irgendwo auftauchten — waehrend `katalog/32-browser-erweiterung.md` das
   * Gegenteil behauptete. Wer nicht erfaehrt, dass Regeln weggefallen sind,
   * haelt einen vollen Puffer fuer einen ruhigen Tag.
   */
  const pflegeText = stand
    ? [
        t('optionen.einstellungen.pflegeText'),
        t('optionen.einstellungen.pflegeStand', {
          anzahl: formatiereZahl(stand.neu),
          datum: formatiereDatum(stand.am) ?? '',
        }),
        stand.uebergangen
          ? t('optionen.einstellungen.pflegeUebergangen', { anzahl: formatiereZahl(stand.uebergangen) })
          : '',
        stand.fehlend?.length ? t('optionen.einstellungen.pflegeAbruf') : '',
        veraltet ? t('optionen.einstellungen.pflegeVeraltet') : '',
      ]
        .filter(Boolean)
        .join(' ')
    : t('optionen.einstellungen.pflegeText');

  async function schalte(l: ListenEintrag, an: boolean) {
    setFehler(null);
    setWartend(l.id);
    setLokal((a) => ({ ...a, [l.id]: an }));
    try {
      await sende({ typ: 'liste.setzen', id: l.id, aktiv: an });
    } catch (e) {
      setLokal((a) => ({ ...a, [l.id]: !an }));
      setFehler(fehlerText(e instanceof NachrichtFehler ? e.code : undefined));
    } finally {
      setWartend(null);
    }
  }

  return (
    <section className="bereich" aria-labelledby="listen-titel">
      <div className="bereich__kopf">
        <h2 id="listen-titel">{t('optionen.listen.titel')}</h2>
        <p>{t('optionen.listen.text')}</p>
      </div>
      {zustand.listenFehler ? <Hinweis art="warn">{fehlerText(zustand.listenFehler)}</Hinweis> : null}
      {fehler ? <Hinweis art="fehler">{fehler}</Hinweis> : null}
      <div className="liste stagger">
        {zustand.listen.length === 0 ? <div className="liste__leer">{t('optionen.listen.leer')}</div> : null}

        {/*
          Der Grundschutz als EINE Zeile. Die elf Listen dahinter werden nicht
          genannt: „uBlock filters - Unbreak" und „Peter Lowe's List" sind
          Eigennamen aus der Filterwelt, die einem Kunden nichts sagen und ihn
          nur vor eine Entscheidung stellen, die er nicht treffen kann.
        */}
        {grund.length > 0 ? (
          <div className="liste__zeile" style={{ '--i': 0 } as React.CSSProperties}>
            <div className="wachsend">
              <div className="liste__name" id="liste-grund-name">
                {t('optionen.listen.grund.name')}
              </div>
              <div className="liste__nebentext">{t('optionen.listen.grund.text')}</div>
            </div>
            <Schalter
              id="liste-grund"
              an={grundAn}
              disabled={grundWartet}
              onWechsel={(neu) => void schalteGrund(neu)}
              aria-labelledby="liste-grund-name"
            />
          </div>
        ) : null}

        {einzeln.map((l, i) => {
          const gesperrt = l.premium && !premium;
          const an = lokal[l.id] ?? l.aktiv;
          const id = `liste-${l.id}`;
          return (
            <div key={l.id} {...kaufProps(gesperrt)} style={{ '--i': i + 1 } as React.CSSProperties}>
              <div className="wachsend">
                <div className="liste__name" id={`${id}-name`}>
                  {nameVon(l)}
                </div>
                <div className="liste__nebentext">{textVon(l)}</div>
              </div>
              {/*
                Keine Regelzahl. Sie war der Rest einer Sicht auf das
                Produkt, die es nicht mehr gibt: Wie viele Netzregeln eine
                Liste mitbringt, kann ein Kunde nicht einordnen, und
                vergleichen laesst es sich schon gar nicht — eine Liste mit
                weniger Regeln kann mehr blocken. Die Zahl stand hier
                trotzdem, weil sie vorhanden war.
              */}
              {gesperrt ? (
                <span className="liste__schloss" title={t('gemeinsam.premium')}>
                  <Schloss />
                </span>
              ) : null}
              {gesperrt ? (
                <SchalterAttrappe />
              ) : (
                <Schalter id={id} an={an} disabled={wartend === l.id} onWechsel={(neu) => void schalte(l, neu)} aria-labelledby={`${id}-name`} />
              )}
            </div>
          );
        })}

        {/*
          Was die Erweiterung ausser Blocken noch tut — in DERSELBEN Liste und
          nicht in einer Karte darunter.
          
          Sie standen bis zum 05.09.2026 unter „Einstellungen", danach kurz in
          einem eigenen Kasten hier. Beides trennte, was zusammengehoert: Fuer
          jemanden, der die Seite oeffnet, ist „Cookie-Banner ausblenden" und
          „Cookie-Fenster beantworten" dieselbe Frage. Zwei Kaesten
          untereinander mit verschiedenem Zeilenbau lesen sich als zwei
          Themen.

          Deshalb tragen sie hier den Listenbau: Name links, Erklaerung
          darunter, Bedienelement rechts. Nur das Element unterscheidet sich —
          zweimal ein Schalter, einmal eine Auswahl.
        */}
        <div {...kaufProps(!premium)}>
          <div className="wachsend">
            <div className="liste__name" id="warnung-name">
              {t('optionen.einstellungen.warnung')}
            </div>
            <div className="liste__nebentext">
              {t('optionen.einstellungen.warnungText')}
            </div>
          </div>
          {!premium ? (
            <span className="liste__schloss" title={t('gemeinsam.premium')}>
              <Schloss />
            </span>
          ) : null}
          {!premium ? (
            <SchalterAttrappe />
          ) : (
            <Schalter
              id="warnung"
              an={e?.warnung ?? false}
              disabled={!e}
              onWechsel={(an) => void aendere({ warnung: an })}
              aria-labelledby="warnung-name"
            />
          )}
        </div>

        <div {...kaufProps(!premium)}>
          <div className="wachsend">
            <div className="liste__name" id="pflege-name">
              {t('optionen.einstellungen.pflege')}
            </div>
            <div className="liste__nebentext">
              {/*
                Kein „Jetzt aktualisieren" mehr. Die Pflege laeuft taeglich und
                wird beim Start nachgeholt; ein Knopf daneben sagt dem Kunden,
                dass er selbst nachhelfen muss. Was der Knopf wert war — zu
                sehen, ob es laeuft —, steht jetzt im Nebentext.
              */}
              {premium ? pflegeText : t('optionen.einstellungen.pflegeText')}
            </div>
          </div>
          {!premium ? (
            <span className="liste__schloss" title={t('gemeinsam.premium')}>
              <Schloss />
            </span>
          ) : null}
          {!premium ? (
            <SchalterAttrappe />
          ) : (
            <Schalter
              id="listenPflege"
              an={e?.listenPflege ?? true}
              disabled={!e}
              onWechsel={(an) => void aendere({ listenPflege: an })}
              aria-labelledby="pflege-name"
            />
          )}
        </div>

        {/*
          Fingerabdruck verwischen. Premium und ab Werk AUS (Begruendung an
          `Einstellungen.fingerabdruck`); durchgesetzt wird beides im
          Hintergrund, hier steht nur die Anzeige.

          Der Nebentext sagt, was es FUER MICH bedeutet, und nicht, wie es
          gemacht wird. Wie es gemacht wird, steht im „i" daneben - wer es
          wissen will, holt es sich; wer nur wissen will, ob er es anschalten
          soll, liest einen Satz.

          Das „i" ist ein echter `<button>` - aber NUR mit Premium. Ohne
          Premium ist die Zeile als Ganzes ein Knopf (`kaufProps`), und ein
          Knopf im Knopf hielte die Tabulatortaste zweimal an derselben Zeile
          an; dieselbe Ueberlegung wie bei `SchalterAttrappe`. Verloren geht
          dabei nichts: Der Tipp haengt ueber `aria-describedby` am Schalter
          und steht damit in beiden Zustaenden in der Vorleseanwendung.

          NICHT in Safari: Das Safari-Manifest laesst die Hauptwelt-Skripte
          weg, weil Safari `world: "MAIN"` nicht sicher kennt (Katalog 32).
          Dort taete der Schalter nichts - und ein Schalter, der ein
          Versprechen traegt und nichts tut, ist derselbe Fehler wie ein
          Formularfeld, das die Route verwirft. Die Zeile kommt, sobald die
          Probe belegt, dass Safari 17 das Skript in der Hauptwelt ausfuehrt.
        */}
        {BROWSER !== 'safari' ? (
          <div {...kaufProps(!premium)}>
            <div className="wachsend">
              <div className="liste__name">
                {/*
                  Die `id` sitzt am Text und nicht an der Zeile: `aria-labelledby`
                  nimmt den GANZEN Inhalt des genannten Elements. Stuende sie
                  aussen, hiesse der Schalter „Fingerabdruck verwischen Was
                  bedeutet das?".
                */}
                <span id="fingerabdruck-name">{t('optionen.einstellungen.fingerabdruck')}</span>
                <span className="tipp">
                  {premium ? (
                    <button
                      type="button"
                      className="tipp__knopf"
                      aria-label={t('optionen.einstellungen.fingerabdruckTippName')}
                      aria-describedby="fingerabdruck-tipp"
                    >
                      <Info groesse={15} />
                    </button>
                  ) : (
                    <span className="tipp__knopf" aria-hidden="true">
                      <Info groesse={15} />
                    </span>
                  )}
                  <span className="tipp__text" role="tooltip" id="fingerabdruck-tipp">
                    {t('optionen.einstellungen.fingerabdruckTipp')}
                  </span>
                </span>
              </div>
              <div className="liste__nebentext">{t('optionen.einstellungen.fingerabdruckText')}</div>
            </div>
            {!premium ? (
              <span className="liste__schloss" title={t('gemeinsam.premium')}>
                <Schloss />
              </span>
            ) : null}
            {!premium ? (
              <SchalterAttrappe />
            ) : (
              <Schalter
                id="fingerabdruck"
                an={e?.fingerabdruck ?? false}
                disabled={!e}
                onWechsel={(an) => void aendere({ fingerabdruck: an })}
                aria-labelledby="fingerabdruck-name"
                aria-describedby="fingerabdruck-tipp"
              />
            )}
          </div>
        ) : null}
        {/*
          Cookie-Fenster beantworten. Eine AUSWAHL und kein Schalter: Ein Klick
          im Namen des Nutzers ist eine Willenserklaerung, und ob er zustimmt
          oder ablehnt, darf nicht die Erweiterung entscheiden.
        */}
        <div {...kaufProps(!premium)}>
          <div className="wachsend">
            <label className="liste__name" htmlFor="cookieAntwort">
              {t('optionen.einstellungen.cookies')}
            </label>
            <div className="liste__nebentext">
              {/*
                Die Zahl kommt aus der Liste selbst, nicht aus dem Satz.
                GEMESSEN am 22.09.2026: Dort stand 17, tatsaechlich sind es 16
                — eine Zahl, die jemand von Hand nachziehen muss, ist frueher
                oder spaeter falsch. Jetzt kann sie das nicht mehr sein.
              */}
              {t('optionen.einstellungen.cookiesText', { anzahl: WERKZEUGE.length })}
            </div>
            {/*
              Der Hinweis steht NUR bei „Immer ablehnen" — bei den anderen
              beiden waere er falsch.

              GEMESSEN am 21.09.2026 an vier Sourcepoint-Seiten (spiegel.de,
              heise.de, welt.de, faz.net): Auf der ersten Ebene gibt es dort
              kein „Alle ablehnen"; `.sp_choice_type_13` kommt null mal vor.
              Die Erweiterung tat daraufhin korrekt nichts — und genau das ist
              der schlechteste Zustand, solange niemand es sagt: Der Nutzer
              hat „ablehnen" eingestellt und glaubt, es werde abgelehnt.
            */}
            {premium && e?.cookieAntwort === 'ablehnen' ? (
              <div className="liste__nebentext liste__einschraenkung">
                {t('optionen.einstellungen.cookiesAblehnenHinweis')}
              </div>
            ) : null}
          </div>
          {!premium ? (
            <span className="liste__schloss" title={t('gemeinsam.premium')}>
              <Schloss />
            </span>
          ) : null}
          {/*
            Ohne Premium eine ATTRAPPE und keine gesperrte Auswahl: Ein
            `<select disabled>` in einer Zeile, die als Ganzes ein Knopf ist,
            faengt den Klick ab, ohne etwas zu tun - genau die Stelle, an der
            gerade nichts passieren darf.
          */}
          {!premium ? (
            <span className="feld__eingabe zeilenwahl zeilenwahl--attrappe" aria-hidden="true">
              {t('optionen.einstellungen.cookiesAus')}
            </span>
          ) : (
            <select
              id="cookieAntwort"
              className="feld__eingabe zeilenwahl"
              value={e?.cookieAntwort ?? 'aus'}
              disabled={!e}
              onChange={(ev) => void aendere({ cookieAntwort: ev.target.value as 'aus' | 'ablehnen' | 'annehmen' })}
            >
              <option value="aus">{t('optionen.einstellungen.cookiesAus')}</option>
              <option value="ablehnen">{t('optionen.einstellungen.cookiesAblehnen')}</option>
              <option value="annehmen">{t('optionen.einstellungen.cookiesAnnehmen')}</option>
            </select>
          )}
        </div>

      </div>

    </section>
  );
}
