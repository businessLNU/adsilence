/**
 * Eingabefeld mit Beschriftung DARUEBER, Hinweis und Fehler DARUNTER. Nie
 * ein Platzhalter als Beschriftung. Der Fehler haengt per
 * `aria-describedby` am Feld, `aria-invalid` sagt dem Screenreader Bescheid.
 */
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type Gemeinsam = {
  id: string;
  label: string;
  hinweis?: ReactNode;
  fehler?: ReactNode;
};

function Huelle({ id, label, hinweis, fehler, children }: Gemeinsam & { children: ReactNode }) {
  return (
    <div className="feld">
      <label className="feld__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hinweis ? (
        <div className="feld__hinweis" id={`${id}-hinweis`}>
          {hinweis}
        </div>
      ) : null}
      {fehler ? (
        <div className="feld__fehler" id={`${id}-fehler`} role="alert">
          {fehler}
        </div>
      ) : null}
    </div>
  );
}

function beschreibung(id: string, hinweis?: ReactNode, fehler?: ReactNode): string | undefined {
  const teile = [];
  if (hinweis) teile.push(`${id}-hinweis`);
  if (fehler) teile.push(`${id}-fehler`);
  return teile.length ? teile.join(' ') : undefined;
}

export function Feld({ id, label, hinweis, fehler, className, ...rest }: Gemeinsam & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Huelle id={id} label={label} hinweis={hinweis} fehler={fehler}>
      <input id={id} className={['feld__eingabe', className ?? ''].join(' ').trim()} aria-invalid={fehler ? 'true' : undefined} aria-describedby={beschreibung(id, hinweis, fehler)} {...rest} />
    </Huelle>
  );
}

export function Textfeld({ id, label, hinweis, fehler, className, ...rest }: Gemeinsam & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Huelle id={id} label={label} hinweis={hinweis} fehler={fehler}>
      <textarea id={id} className={['feld__eingabe', className ?? ''].join(' ').trim()} aria-invalid={fehler ? 'true' : undefined} aria-describedby={beschreibung(id, hinweis, fehler)} {...rest} />
    </Huelle>
  );
}

export function Auswahl({ id, label, hinweis, fehler, className, children, ...rest }: Gemeinsam & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <Huelle id={id} label={label} hinweis={hinweis} fehler={fehler}>
      <select id={id} className={['feld__eingabe', className ?? ''].join(' ').trim()} aria-describedby={beschreibung(id, hinweis, fehler)} {...rest}>
        {children}
      </select>
    </Huelle>
  );
}
