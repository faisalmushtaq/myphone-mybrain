import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import type { DateParts } from '../../model/types';

interface BaseProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Shown after the label, for example "optional". */
  tag?: string;
}

export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function FieldWrapper({ id, label, hint, error, required, tag, children, as = 'div' }: BaseProps & { children: ReactNode; as?: 'div' | 'fieldset' }) {
  const Tag = as;
  const LabelTag = as === 'fieldset' ? 'legend' : 'label';
  return (
    <Tag className={`mpmb-field${error ? ' has-error' : ''}`}>
      <LabelTag className="mpmb-label" htmlFor={as === 'div' ? id : undefined}>
        {label}
        {tag ? <span className="mpmb-label__tag"> {tag}</span> : required === false ? <span className="mpmb-label__tag"> (optional)</span> : null}
      </LabelTag>
      {hint && (
        <p className="mpmb-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="mpmb-error" id={`${id}-error`}>
          <span className="mpmb-sr-only">Error: </span>
          {error}
        </p>
      )}
      {children}
    </Tag>
  );
}

type TextProps = BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required'> & { width?: 'full' | 'half' | 'short' };

export function TextField({ id, label, hint, error, required, tag, width = 'full', className = '', ...rest }: TextProps) {
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={required} tag={tag}>
      <input
        id={id}
        className={`mpmb-input mpmb-input--${width} ${className}`.trim()}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        {...rest}
      />
    </FieldWrapper>
  );
}

type SelectProps = BaseProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'required'> & { options: { value: string; label: string }[]; placeholder?: string };

export function SelectField({ id, label, hint, error, required, tag, options, placeholder = 'Choose one', className = '', ...rest }: SelectProps) {
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error} required={required} tag={tag}>
      <select id={id} className={`mpmb-select ${className}`.trim()} aria-describedby={describedBy(id, hint, error)} aria-invalid={error ? true : undefined} aria-required={required || undefined} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: string;
  error?: string;
  emphasis?: boolean;
}

/** A large, card-like checkbox so the whole row is a tap target. */
export function CheckboxField({ id, checked, onChange, label, hint, error, emphasis }: CheckboxProps) {
  return (
    <div className={`mpmb-check${checked ? ' is-checked' : ''}${error ? ' has-error' : ''}${emphasis ? ' mpmb-check--emphasis' : ''}`}>
      {error && (
        <p className="mpmb-error" id={`${id}-error`}>
          <span className="mpmb-sr-only">Error: </span>
          {error}
        </p>
      )}
      <label className="mpmb-check__label" htmlFor={id}>
        <input id={id} type="checkbox" className="mpmb-check__input" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy(id, hint, error)} aria-invalid={error ? true : undefined} />
        <span className="mpmb-check__box" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
            <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="mpmb-check__text">{label}</span>
      </label>
      {hint && (
        <p className="mpmb-hint mpmb-check__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface ChoiceProps {
  id: string;
  name: string;
  legend: ReactNode;
  value: string | null;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  error?: string;
}

/** Explicit choice (for example Yes / No) rendered as large radio buttons. */
export function ChoiceField({ id, name, legend, value, onChange, options, hint, error }: ChoiceProps) {
  return (
    <fieldset className={`mpmb-choice${error ? ' has-error' : ''}`} id={`${id}-group`}>
      <legend className="mpmb-choice__legend">{legend}</legend>
      {hint && (
        <p className="mpmb-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="mpmb-error" id={`${id}-error`}>
          <span className="mpmb-sr-only">Error: </span>
          {error}
        </p>
      )}
      <div className="mpmb-choice__options">
        {options.map((o) => {
          const optionId = `${id}-${o.value}`;
          return (
            <label key={o.value} className={`mpmb-choice__option${value === o.value ? ' is-selected' : ''}`} htmlFor={optionId}>
              <input
                id={optionId}
                type="radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                className="mpmb-choice__input"
                aria-describedby={describedBy(id, hint, error)}
                aria-invalid={error ? true : undefined}
              />
              <span className="mpmb-choice__dot" aria-hidden="true" />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface DateProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value: DateParts;
  onChange: (value: DateParts) => void;
  /** 'self' offers the browser's saved birthday; 'off' when someone is entering another person's date. */
  autofill?: 'self' | 'off';
  /** Earliest and latest selectable dates, YYYY-MM-DD. */
  min?: string;
  max?: string;
}

/** Turns day/month/year parts into YYYY-MM-DD for a date input, or '' while incomplete. */
export function partsToInputValue(value: DateParts): string {
  if (!value.year || !value.month || !value.day || value.year.length !== 4) return '';
  return `${value.year}-${value.month.padStart(2, '0')}-${value.day.padStart(2, '0')}`;
}

/** A native date input: the phone's own date picker on mobile, a calendar on desktop. Stored as day/month/year parts. */
export function DateField({ id, label, hint, error, value, onChange, autofill = 'off', min, max }: DateProps) {
  return (
    <FieldWrapper id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="date"
        className="mpmb-input mpmb-input--date"
        value={partsToInputValue(value)}
        min={min}
        max={max}
        autoComplete={autofill === 'self' ? 'bday' : 'off'}
        onChange={(e) => {
          const [year = '', month = '', day = ''] = e.target.value.split('-');
          onChange({ day, month, year });
        }}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
      />
    </FieldWrapper>
  );
}
