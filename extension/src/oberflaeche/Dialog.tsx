/**
 * Ein modaler Dialog auf `<dialog>`: Fokusfalle, Escape und Backdrop kommen
 * vom Browser. Eintritt 200 ms von scale(0.96), Austritt 140 ms (schneller
 * als der Eintritt), beides nur transform und opacity; unter
 * reduced-motion nur opacity (`bewegung.css`).
 *
 * `data-offen` wird einen Frame nach `showModal()` gesetzt, damit die
 * Uebergaenge greifen; `@starting-style` kennt Firefox 128 noch nicht.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SymbolKnopf } from './Knopf.tsx';
import { Kreuz } from './Symbole.tsx';

const AUSTRITT_MS = 140;

export function Dialog({
  offen,
  onSchliessen,
  titel,
  schliessenText,
  children,
  fuss,
  className,
}: {
  offen: boolean;
  onSchliessen: () => void;
  titel: string;
  /** Name des Kreuzes, aus `t('gemeinsam.schliessen')`. */
  schliessenText: string;
  children: ReactNode;
  fuss?: ReactNode;
  /** Zusatzklasse am `<dialog>`, etwa `dialog--breit` fuer das Kauffenster. */
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sichtbar, setSichtbar] = useState(false);
  const [imDom, setImDom] = useState(offen);

  useEffect(() => {
    const el = ref.current;
    if (offen) {
      setImDom(true);
      // Einen Frame warten: `showModal()` und `data-offen` im selben Tick
      // ergaeben keinen Uebergang, der Dialog staende einfach da.
      const id = requestAnimationFrame(() => {
        if (el && !el.open) el.showModal();
        setSichtbar(true);
      });
      return () => cancelAnimationFrame(id);
    }
    setSichtbar(false);
    const t = setTimeout(() => {
      if (el?.open) el.close();
      setImDom(false);
    }, AUSTRITT_MS);
    return () => clearTimeout(t);
  }, [offen]);

  // Ein spaeter gemounteter <dialog> muss trotzdem geoeffnet werden.
  useEffect(() => {
    const el = ref.current;
    if (offen && imDom && el && !el.open) el.showModal();
  }, [offen, imDom]);

  if (!imDom) return null;

  return (
    <dialog
      ref={ref}
      className={['dialog', className ?? ''].join(' ').trim()}
      data-offen={sichtbar ? '1' : '0'}
      aria-labelledby="dialog-titel"
      onCancel={(e) => {
        e.preventDefault();
        onSchliessen();
      }}
      onClick={(e) => {
        // Klick auf den Backdrop: das Ziel ist das <dialog> selbst.
        if (e.target === ref.current) onSchliessen();
      }}
    >
      <div className="dialog__inhalt">
        <div className="dialog__kopf">
          <h2 id="dialog-titel">{titel}</h2>
          <SymbolKnopf beschriftung={schliessenText} onClick={onSchliessen}>
            <Kreuz />
          </SymbolKnopf>
        </div>
        {children}
        {fuss ? <div className="dialog__fuss">{fuss}</div> : null}
      </div>
    </dialog>
  );
}
