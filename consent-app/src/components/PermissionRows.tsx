import type { Statement } from '../config/statements';
import type { StatementRecord, StatementResponse } from '../model/types';
import { Disclosure } from './ui/Disclosure';
import { Draft } from './ui/Draft';

interface Props {
  statements: Statement[];
  responses: Record<string, StatementRecord>;
  errors: Record<string, string>;
  onRespond: (statement: Statement, response: StatementResponse) => void;
}

/**
 * The optional permissions as compact rows: the statement on the left and an
 * explicit Yes / No on the right. Each row is a fieldset, so screen readers
 * hear the statement as the group name for the two radio buttons.
 */
export function PermissionRows({ statements, responses, errors, onRespond }: Props) {
  return (
    <ul className="mpmb-permissions" role="list">
      {statements.map((s) => {
        const id = `stmt-${s.id}`;
        const value = responses[s.id]?.response ?? null;
        const error = errors[`${id}-agreed`];
        return (
          <li key={s.id} className={`mpmb-permission${value ? ` is-${value}` : ''}${error ? ' has-error' : ''}`}>
            <fieldset className="mpmb-permission__fieldset">
              <legend className="mpmb-permission__legend">
                <span className="mpmb-permission__label">
                  {s.label}
                  {s.draft && <Draft />}
                </span>
                <span className="mpmb-permission__text">{s.text}</span>
              </legend>
              {error && (
                <p className="mpmb-error" id={`${id}-error`}>
                  <span className="mpmb-sr-only">Error: </span>
                  {error}
                </p>
              )}
              <div className="mpmb-permission__choice" role="presentation">
                {(['agreed', 'declined'] as const).map((option) => (
                  <label key={option} className={`mpmb-permission__option${value === option ? ' is-selected' : ''}`} htmlFor={`${id}-${option}`}>
                    <input id={`${id}-${option}`} type="radio" name={id} value={option} className="mpmb-choice__input" checked={value === option} onChange={() => onRespond(s, option)} aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} />
                    <span className="mpmb-choice__dot" aria-hidden="true" />
                    {option === 'agreed' ? 'Yes' : 'No'}
                  </label>
                ))}
              </div>
              {s.more && (
                <Disclosure summary="More about this" className="mpmb-permission__more">
                  <p>{s.more}</p>
                </Disclosure>
              )}
            </fieldset>
          </li>
        );
      })}
    </ul>
  );
}
