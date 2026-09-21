/**
 * Der Schalter: ein `<button role="switch">`, kein Kontrollkaestchen mit
 * CSS-Verkleidung. So bekommt er Tastatur, Fokus und Screenreader gratis.
 *
 * Der Knopf gleitet mit `transform`, 200 ms ease-out (`bewegung.css`). Das
 * ist Zustandsanzeige, kein Huepfen: Wer schaltet, soll sehen, dass es
 * angekommen ist, nicht warten.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> & {
  an: boolean;
  onWechsel: (an: boolean) => void;
  gross?: boolean;
  /** Sichtbarer Name; wenn er woanders steht, `aria-labelledby` reichen. */
  beschriftung?: string;
};

export function Schalter({ an, onWechsel, gross, beschriftung, className, disabled, ...rest }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={an ? 'true' : 'false'}
      aria-label={beschriftung}
      className={['schalter', gross ? 'schalter--gross' : '', className ?? ''].join(' ').trim()}
      disabled={disabled}
      onClick={() => onWechsel(!an)}
      {...rest}
    >
      <span className="schalter__bahn">
        <span className="schalter__knopf" />
      </span>
    </button>
  );
}

/**
 * Zeile mit Titel, Nebentext und Schalter rechts. Die ganze Zeile ist der
 * Name des Schalters (`aria-labelledby`), Klick auf den Text schaltet mit.
 */
export function Schalterzeile({
  id,
  titel,
  text,
  an,
  onWechsel,
  disabled,
  gross,
  rechts,
}: {
  id: string;
  titel: ReactNode;
  text?: ReactNode;
  an: boolean;
  onWechsel: (an: boolean) => void;
  disabled?: boolean;
  gross?: boolean;
  /** Etwas zwischen Text und Schalter, etwa ein Schloss. */
  rechts?: ReactNode;
}) {
  return (
    <div className="schalterzeile">
      <div className="schalterzeile__text" id={`${id}-text`} onClick={() => !disabled && onWechsel(!an)}>
        <div className="schalterzeile__titel">{titel}</div>
        {text ? <div className="schwach klein">{text}</div> : null}
      </div>
      {rechts}
      <Schalter id={id} an={an} onWechsel={onWechsel} disabled={disabled} gross={gross} aria-labelledby={`${id}-text`} />
    </div>
  );
}
