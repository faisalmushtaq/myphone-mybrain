import type { Statement } from '../config/statements';
import type { StatementRecord, StatementResponse } from '../model/types';
import { CheckboxField, ChoiceField } from './ui/Field';
import { Disclosure } from './ui/Disclosure';
import { Draft } from './ui/Draft';

interface Props {
  statements: Statement[];
  responses: Record<string, StatementRecord>;
  errors: Record<string, string>;
  onRespond: (statement: Statement, response: StatementResponse) => void;
  onClear?: (statement: Statement) => void;
  /** Wording of the Yes/No options, e.g. for younger readers. */
  yesLabel?: string;
  noLabel?: string;
}

/**
 * Renders consent or assent statements. Required statements are a checkbox
 * that must be ticked; optional statements are an explicit Yes / No so that
 * an unanswered statement is never mistaken for a "no".
 */
export function StatementList({ statements, responses, errors, onRespond, onClear, yesLabel = 'Yes', noLabel = 'No' }: Props) {
  return (
    <ol className="mpmb-statements" role="list">
      {statements.map((statement, i) => {
        const record = responses[statement.id];
        const fieldId = `stmt-${statement.id}`;
        return (
          <li key={statement.id} className={`mpmb-statement mpmb-statement--${statement.kind}${record ? ` is-${record.response}` : ''}`}>
            <div className="mpmb-statement__head">
              <span className="mpmb-statement__number" aria-hidden="true">
                {i + 1}
              </span>
              <span className="mpmb-statement__label">{statement.label}</span>
              {statement.kind === 'required' ? <span className="mpmb-statement__tag">Needed to take part</span> : <span className="mpmb-statement__tag mpmb-statement__tag--optional">Your choice</span>}
              {statement.draft && <Draft />}
            </div>
            {statement.kind === 'required' ? (
              <CheckboxField
                id={fieldId}
                checked={record?.response === 'agreed'}
                onChange={(checked) => (checked ? onRespond(statement, 'agreed') : onClear ? onClear(statement) : onRespond(statement, 'declined'))}
                label={statement.text}
                error={errors[fieldId]}
                emphasis
              />
            ) : (
              <ChoiceField
                id={fieldId}
                name={fieldId}
                legend={statement.text}
                value={record?.response ?? null}
                onChange={(v) => onRespond(statement, v as StatementResponse)}
                options={[
                  { value: 'agreed', label: yesLabel },
                  { value: 'declined', label: noLabel },
                ]}
                error={errors[`${fieldId}-agreed`]}
              />
            )}
            {statement.more && (
              <Disclosure>
                <p>{statement.more}</p>
              </Disclosure>
            )}
          </li>
        );
      })}
    </ol>
  );
}
