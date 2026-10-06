import { useState } from 'react';
import { parentQuestionsForm } from '../config/questions';
import { childAssentForm, parentConsentForm } from '../config/statements';
import { study } from '../config/study';
import { relationships } from '../config/fields';
import { OTHER_SCHOOL_ID, schools } from '../config/schools';
import { platforms } from '../config/walkthroughs';
import { formatIsoDate, formatParts, formatTimestamp } from '../lib/dates';
import { phoneUseApplies } from '../model/journey';
import { imageStore } from '../lib/imageStore';
import type { SignatureRecord, StepId } from '../model/types';
import { useStore } from '../state/context';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

interface Props {
  onChange?: (step: StepId) => void;
  /** Include the technical rows (form versions, exact times) — for the final record, not the check page. */
  detailed?: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mpmb-summary__row">
      <dt>{label}</dt>
      <dd>{value || <span className="mpmb-summary__empty">Not given</span>}</dd>
    </div>
  );
}

function Response({ response }: { response: 'agreed' | 'declined' | undefined }) {
  if (response === 'agreed')
    return (
      <span className="mpmb-response is-agreed">
        <Icon name="check" size={16} /> Yes
      </span>
    );
  if (response === 'declined') return <span className="mpmb-response is-declined">No</span>;
  return <span className="mpmb-summary__empty">Not answered</span>;
}

function Signature({ signature, who }: { signature: SignatureRecord | null; who: string }) {
  if (!signature) return null;
  if (signature.method === 'drawn' && signature.imageDataUrl) return <img className="mpmb-summary__signature" src={signature.imageDataUrl} alt={`Drawn signature of ${who}`} />;
  return <span className="mpmb-summary__typed-signature">{signature.typedName} (typed)</span>;
}

/** Partly hides contact details so they are not on show to whoever is holding the phone. */
function mask(value: string, keep = 2): string {
  const v = value.trim();
  if (!v) return '';
  if (v.includes('@')) {
    const [user, domain] = v.split('@');
    return `${user.slice(0, keep)}${'•'.repeat(Math.max(2, user.length - keep))}@${domain}`;
  }
  return `${v.slice(0, keep)}${'•'.repeat(Math.max(3, v.length - keep - 2))}${v.slice(-2)}`;
}

/**
 * The record of who agreed to what, and when. Used on the check page (with
 * change links) and on the thank-you page (read-only).
 */
export function ConsentSummary({ onChange, detailed = false }: Props) {
  const { state } = useStore();
  const [reveal, setReveal] = useState(false);
  const { identity, guardian, consent, assent, donation, survey } = state;
  const answered = parentQuestionsForm.questions.filter((q) => survey.responses[q.id]).length;
  const schoolName = identity.schoolId === OTHER_SCHOOL_ID ? identity.schoolOther : schools.find((s) => s.id === identity.schoolId)?.name ?? '';
  const relationship = guardian.relationship === 'other' ? guardian.relationshipOther : relationships.find((r) => r.id === guardian.relationship)?.label ?? '';
  const childName = identity.firstName.trim() || 'the young person';
  const show = (value: string) => (reveal || detailed ? value : mask(value));
  const guardianStep: StepId = state.route === 'parent' ? 'child-details' : 'parent-details';

  const section = (title: string, step: StepId | null, kind: 'identity' | 'record' | 'research', body: React.ReactNode) => (
    <section className={`mpmb-summary mpmb-summary--${kind}`} aria-labelledby={`summary-${step ?? title}`}>
      <div className="mpmb-summary__head">
        <h2 className="mpmb-h3" id={`summary-${step ?? title}`}>
          {title}
        </h2>
        {onChange && step && (
          <button type="button" className="mpmb-summary__change" onClick={() => onChange(step)}>
            Change<span className="mpmb-sr-only"> {title.toLowerCase()}</span>
          </button>
        )}
      </div>
      {body}
    </section>
  );

  return (
    <div className="mpmb-summaries">
      {section(
        'Young person’s details',
        'child-details',
        'identity',
        <dl className="mpmb-summary__list">
          <Row label="Name" value={`${identity.firstName} ${identity.lastName}`.trim()} />
          <Row label="Date of birth" value={formatParts(identity.dateOfBirth)} />
          <Row label="School" value={schoolName} />
          <Row label="Year group" value={identity.yearGroup} />
        </dl>,
      )}

      {section(
        'Parent or guardian',
        guardianStep,
        'identity',
        <>
          <dl className="mpmb-summary__list">
            <Row label="Name" value={guardian.fullName} />
            <Row label="Relationship" value={relationship} />
            <Row label="Email" value={show(guardian.email)} />
            <Row label="Phone" value={show(guardian.phone)} />
            <Row label="Postcode" value={show(guardian.postcode.toUpperCase())} />
          </dl>
          {!detailed && (guardian.email || guardian.phone || guardian.postcode) && (
            <Button variant="link" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
              {reveal ? 'Hide contact details' : 'Show contact details'}
            </Button>
          )}
        </>,
      )}

      {section(
        'Parent or guardian permission',
        'parent-consent',
        'record',
        <>
          <ul className="mpmb-summary__statements" role="list">
            {parentConsentForm.statements.map((s) => (
              <li key={s.id}>
                <span>{s.label}</span>
                <Response response={consent.responses[s.id]?.response} />
              </li>
            ))}
          </ul>
          <dl className="mpmb-summary__list">
            <Row label="Signed by" value={consent.typedName} />
            <Row label="Signature" value={<Signature signature={consent.signature} who={consent.typedName || 'the parent or guardian'} />} />
            <Row label="Date" value={consent.confirmedDate ? formatIsoDate(consent.confirmedDate) : ''} />
            {detailed && <Row label="Recorded" value={consent.completedAt ? formatTimestamp(consent.completedAt) : ''} />}
            {detailed && <Row label="Form version" value={`${consent.formId} ${consent.formVersion}`} />}
            {detailed && <Row label="Information version" value={consent.informationVersion ?? ''} />}
          </dl>
        </>,
      )}

      {study.parentQuestions &&
        section(
          'Parent or guardian’s quick questions',
          'parent-questions',
          'research',
          <p className="mpmb-summary__note">
            {survey.status === 'not-started' ? 'Not answered yet.' : survey.status === 'skipped' && !answered ? 'Skipped — these questions are optional.' : `${answered} of ${parentQuestionsForm.questions.length} answered.`} The answers are kept with {childName}’s code and are not shown again on this phone.
          </p>,
        )}

      {section(
        `${childName}’s agreement`,
        assent.status === 'deferred' ? null : 'child-assent',
        'record',
        assent.status === 'deferred' ? (
          <p className="mpmb-summary__note">
            {assent.deferredBy === 'young' ? `${childName} would like to decide later. The team will ask again, for example at school.` : 'To be collected separately, for example at school.'}{phoneUseApplies(state) ? '' : ' The screen-time part will wait until then.'}
          </p>
        ) : assent.status === 'not-started' ? (
          <p className="mpmb-summary__note">Not completed yet.</p>
        ) : (
          <>
            <ul className="mpmb-summary__statements" role="list">
              {childAssentForm.statements
                .filter((s) => assent.responses[s.id])
                .map((s) => (
                  <li key={s.id}>
                    <span>{s.label}</span>
                    <Response response={assent.responses[s.id]?.response} />
                  </li>
                ))}
            </ul>
            <dl className="mpmb-summary__list">
              <Row label="Signature" value={<Signature signature={assent.signature} who={childName} />} />
              {detailed && <Row label="Recorded" value={assent.completedAt ? formatTimestamp(assent.completedAt) : ''} />}
              {detailed && <Row label="Form version" value={`${assent.formId} ${assent.formVersion}`} />}
            </dl>
          </>
        ),
      )}

      {section(
        'Screen time and apps',
        donation.status === 'not-consented' || donation.status === 'deferred' ? null : 'phone-use',
        'research',
        donation.status === 'not-consented' ? (
          <p className="mpmb-summary__note">Not shared — you chose not to share screen-time information. You can change this later by contacting the team.</p>
        ) : donation.status === 'deferred' ? (
          <p className="mpmb-summary__note">Waiting until {childName} has given their agreement.</p>
        ) : donation.status === 'skipped' ? (
          <p className="mpmb-summary__note">Skipped for now. The team can send a link to add it later.</p>
        ) : (
          <>
            <dl className="mpmb-summary__list">
              <Row label="Phone" value={platforms.find((p) => p.id === donation.platform)?.name ?? ''} />
              <Row label="Screenshots" value={donation.images.length ? `${donation.images.filter((i) => i.status === 'sent').length} sent${donation.images.some((i) => i.status !== 'sent') ? `, ${donation.images.filter((i) => i.status !== 'sent').length} not yet sent` : ''}` : ''} />
            </dl>
            {donation.images.length > 0 && (
              <ul className="mpmb-summary__thumbs" role="list">
                {donation.images.map((img, i) => {
                  const stored = imageStore.get(img.id);
                  return (
                    <li key={img.id}>
                      {stored ? <img src={stored.url} alt={`Image ${i + 1}${img.redacted ? ', with hidden areas' : ''}`} /> : <span className="mpmb-summary__thumb-placeholder">Image {i + 1}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ),
      )}
    </div>
  );
}
