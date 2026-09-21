/**
 * Kopfzeile: Zeichen, Name, bei Premium das Abzeichen, rechts das Zahnrad.
 *
 * ── Warum das Abzeichen oben steht und nicht in der Premium-Karte ─────────
 * In der Karte steht schon, WAS Premium kann und bis wann es laeuft. Oben
 * geht es um etwas anderes: Wer bezahlt hat, soll es beim Oeffnen sehen,
 * ohne zu scrollen und ohne zu lesen. Ein Wort in der Markenfarbe reicht --
 * es ist die einzige farbige Stelle im Kopf und faellt deshalb auf, ohne
 * laut zu sein.
 * Das Zeichen ist das PNG aus `icons/`; ohne Paket (Vorschau) faellt es
 * auf die SVG-Marke zurueck.
 */
import { useState } from 'react';
import { SymbolKnopf } from '../../oberflaeche/Knopf.tsx';
import { Marke, Zahnrad } from '../../oberflaeche/Symbole.tsx';
import { t } from '../../oberflaeche/i18n.ts';
import { oeffneOptionen, paketUrl } from '../../oberflaeche/laufzeit.ts';

export function Kopf({ premium = false }: { premium?: boolean }) {
  const [bildFehlt, setBildFehlt] = useState(false);
  return (
    <header className="kopf">
      <div className="kopf__marke">
        {bildFehlt ? <Marke groesse={22} /> : <img className="kopf__bild" src={paketUrl('icons/icon-32.png')} alt="" onError={() => setBildFehlt(true)} />}
        <span>{t('extName')}</span>
        {premium ? <span className="kopf__premium">{t('gemeinsam.premium')}</span> : null}
      </div>
      <SymbolKnopf beschriftung={t('popup.optionen')} onClick={() => void oeffneOptionen()}>
        <Zahnrad />
      </SymbolKnopf>
    </header>
  );
}
