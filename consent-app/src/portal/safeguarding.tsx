import { useState, type ReactNode } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { CheckboxField } from '../components/ui/Field';
import { ask, messageOf } from './api';
import type { Me } from './types';

/**
 * The schools study's safeguarding procedure (the team's draft of 7 November
 * 2026), for everyone in the portal to read at any time, and to confirm they
 * have read and understood. The version must match SAFEGUARDING_VERSION in
 * firebase/functions/src/portalCore.ts (a test checks); changing it asks
 * everyone to confirm again, and until they have they are not ready for visits.
 */
export const SAFEGUARDING_VERSION = '7 November 2026';

/** Whether this person has confirmed the current version. */
export const safeguardingRead = (me: Me) => me.user?.safeguarding?.version === (me.safeguardingVersion ?? SAFEGUARDING_VERSION);

const SECTIONS = [
  ['sg-purpose', 'Purpose and scope'],
  ['sg-principles', 'Principles'],
  ['sg-session', 'Concerns raised during a session'],
  ['sg-later', 'Found later, in the data'],
  ['sg-flow', 'Every concern ends with the school’s DSL'],
  ['sg-distress', 'Difficult questions and distress'],
  ['sg-roles', 'Roles'],
  ['sg-records', 'Records'],
  ['sg-support', 'Support for the research team'],
  ['sg-lab', 'The adult lab study'],
  ['sg-told', 'What families and schools are told'],
] as const;

const Tel = ({ n, children }: { n: string; children?: ReactNode }) => <a href={`tel:${n.replace(/\s/g, '')}`}>{children ?? n}</a>;
const Mail = ({ to }: { to: string }) => <a href={`mailto:${to}`}>{to}</a>;
const Site = ({ path, children }: { path: string; children: ReactNode }) => (
  <a href={`https://myphonemybrain.com${path}`} target="_blank" rel="noreferrer">
    {children}
  </a>
);

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 className="mpmb-h2 mpmb-sg__h" id={id} tabIndex={-1}>
      {children}
    </h2>
  );
}

function Steps({ steps, final }: { steps: ReactNode[]; final?: number }) {
  return (
    <ol className="mpmb-sg__flow">
      {steps.map((s, i) => (
        <li key={i} className={i === final ? 'is-final' : ''}>
          {s}
        </li>
      ))}
    </ol>
  );
}

function Acknowledge({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = me.safeguardingVersion ?? SAFEGUARDING_VERSION;
  const mine = me.user?.safeguarding;
  if (mine?.version === version)
    return (
      <Callout tone="success" title="You have confirmed you read and understand this procedure">
        <p>
          Confirmed {mine.at ? new Date(mine.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''} (version of {version}). Come back to it whenever you need it: it is always under Safeguarding.
        </p>
      </Callout>
    );
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await ask('safeguarding-ack', { version });
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mpmb-card mpmb-sg__ack" id="sg-confirm">
      <h2 className="mpmb-h2">Confirm you have read it</h2>
      {mine && <p>The procedure has changed since you last confirmed it (you confirmed the version of {mine.version}). Please read it again.</p>}
      <p>Everyone who helps at school visits must read this procedure and confirm they understand it. Until you do, you are not ready to be booked onto a visit.</p>
      <CheckboxField id="sg-tick" checked={ticked} onChange={setTicked} emphasis label={<>I have read the MyPhone/MyBrain safeguarding procedure (version of {version}), I understand it, and I will follow it.</>} />
      {error && (
        <p className="mpmb-error" role="alert">
          {error}
        </p>
      )}
      <div className="mpmb-actions">
        <Button variant="primary" loading={busy} disabled={!ticked} onClick={() => void confirm()}>
          Confirm
        </Button>
      </div>
    </div>
  );
}

/** A reminder on the home pages until the current version is confirmed. */
export function SafeguardingPrompt({ me, go }: { me: Me; go: (hash: string) => void }) {
  if (safeguardingRead(me)) return null;
  const changed = Boolean(me.user?.safeguarding);
  return (
    <Callout tone="important" title={changed ? 'The safeguarding procedure has changed' : 'Read the safeguarding procedure'}>
      <p>{changed ? 'Please read it again and confirm.' : 'Everyone who helps at school visits must read it and confirm they understand it before they can be booked.'}</p>
      <Button variant="primary" onClick={() => go('#safeguarding')}>
        Read it now
      </Button>
    </Callout>
  );
}

export function Safeguarding({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const jump = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
  };
  const read = safeguardingRead(me);
  return (
    <article className="mpmb-tools__section mpmb-sg">
      <header>
        <p className="mpmb-hint">
          Schools study · draft of 7 November 2026 · to be included in an ethics amendment for SoPREC 2026 4202-7024
        </p>
        <p className="mpmb-sg__lead">
          We must act straight away on any safeguarding concern raised during a school session. If a concern arises during data analysis, we will also follow up a survey answer if it suggests a child, or someone else, is at serious risk of harm now.
        </p>
        <p>This procedure sets out an explicit process so our whole team can work consistently and confidently with young people.</p>
      </header>

      {!read && (
        <p>
          <Button variant="secondary" onClick={() => jump('sg-confirm')}>
            Go to “Confirm you have read it”
          </Button>
        </p>
      )}

      <Callout tone="important" title="In a hurry? The essentials">
        <ul>
          <li>
            <strong>Someone tells you something, or you see something:</strong> listen, don’t promise secrecy, write down their words, tell the school’s <strong>DSL the same day</strong>, then the project coordinator and the PI.
          </li>
          <li>
            <strong>A child is in immediate danger and the DSL can’t be reached:</strong> tell another teacher straight away and/or call <Tel n="999" />, then tell the DSL.
          </li>
          <li>
            <strong>You notice something in the data:</strong> stop, don’t search for more, and tell the project coordinator and the PI <strong>within one working day</strong>.
          </li>
          <li>
            <strong>Support for young people:</strong> an adult they trust, and Childline, <Tel n="0800 1111" /> (free, any time).
          </li>
        </ul>
      </Callout>

      <nav className="mpmb-card mpmb-sg__toc" aria-label="Contents">
        <h2 className="mpmb-h3">Contents</h2>
        <ol>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <Button variant="link" onClick={() => jump(id)}>
                {label}
              </Button>
            </li>
          ))}
        </ol>
      </nav>

      <H id="sg-purpose">Purpose and scope</H>
      <p>This procedure covers the MyPhone/MyBrain schools study:</p>
      <ul>
        <li>the workshops in school (EEG, computer task, surveys);</li>
        <li>the study’s data records after the session, including the survey answers, while they are processed and analysed.</li>
      </ul>
      <p>This sits alongside each school’s own child protection policy, which we follow when we are in school. The adult lab study (the social media break study and its control group) has its own arrangement, described at the end.</p>

      <H id="sg-principles">Principles</H>
      <ol className="mpmb-sg__principles">
        <li>
          <strong>We act on what we hear and see.</strong> Anything a young person tells a researcher, or anything that happens during a session, that raises a concern goes to the school’s designated safeguarding lead (DSL) the same day.
        </li>
        <li>
          <strong>We do not monitor research answers.</strong> Survey answers are research data under a study code. Nobody reads them during the session or checks them one by one, and it is possible that they may not be looked at for months.
        </li>
        <li>
          <strong>We clearly communicate the process.</strong> Young people and parents are told that the answers are not read at the time, so anyone who needs help should tell a researcher, a teacher or an adult they trust.
        </li>
        <li>
          <strong>We keep scope to act later.</strong> If someone analysing the data comes across an answer that meets the threshold below, we may use the study code to find out whose it is and tell the school’s DSL.
        </li>
        <li>
          <strong>We do not identify children for any other reason.</strong> Apart from a concern that meets the threshold, the research team does not link answers back to a name.
        </li>
        <li>
          <strong>The school leads.</strong> We pass concerns to the school’s DSL, who decides what happens next under the school’s procedures. We do not contact parents or other agencies ourselves, unless a child is in immediate danger and the DSL cannot be reached (then we call 999).
        </li>
      </ol>

      <H id="sg-session">Concerns raised during a session</H>
      <p>This covers anything a young person tells a researcher, anything a researcher sees or hears, and anything a young person writes and shows to a researcher at the time.</p>
      <div className="mpmb-sg__cards">
        <section className="mpmb-card">
          <h3 className="mpmb-h3">Before the visit</h3>
          <ul>
            <li>We ask the school for the name and contact details of its DSL and deputy, and for its child protection policy.</li>
            <li>The lead researcher for the visit makes sure everyone on the team knows who the DSL is.</li>
          </ul>
        </section>
        <section className="mpmb-card">
          <h3 className="mpmb-h3">If a young person tells you something</h3>
          <ul>
            <li>Listen, stay calm and let them speak. Do not ask leading questions or investigate.</li>
            <li>Do not promise to keep it secret. Explain kindly that you need to tell someone at school who can help.</li>
            <li>Write down what was said, in their words, with the time, as soon as you can.</li>
          </ul>
        </section>
        <section className="mpmb-card">
          <h3 className="mpmb-h3">Passing it on</h3>
          <ul>
            <li>Tell the school’s DSL (or deputy) in person or by phone the same day, before the team leaves the school if possible.</li>
            <li>
              If a child is in immediate danger and the DSL cannot be reached, contact another teacher straight away and/or call <Tel n="999" />, and then tell the DSL as soon as they are contactable.
            </li>
            <li>Tell the project coordinator (Dr Sarmad Ali) and the PI (Professor Faisal Mushtaq) the same day.</li>
          </ul>
        </section>
        <section className="mpmb-card">
          <h3 className="mpmb-h3">Recording</h3>
          <ul>
            <li>The project coordinator will record it in the safeguarding log (see Records). The log holds what was said or seen, who was told and when. It is kept apart from the research data.</li>
          </ul>
        </section>
      </div>

      <H id="sg-later">Found later, in the data</H>
      <p>“Found later” means anything noticed after the session in the study’s data records: survey answers, free text, notes made at the session, or anything else recorded, whenever it is seen during data processing or analysis.</p>
      <p>
        We follow up something found later if it suggests that <strong>a child, or someone else, is at serious risk of harm now</strong>. This is the same test schools use for significant harm under Keeping Children Safe in Education.
      </p>
      <div className="mpmb-sg__threshold">
        <section className="mpmb-sg__meets">
          <h3 className="mpmb-h3">Meets the threshold</h3>
          <ul>
            <li>The child says they are being hurt, abused or neglected</li>
            <li>The child describes plans or intent to seriously harm or kill themselves</li>
            <li>The child describes intent to harm someone else</li>
            <li>The child describes another child being harmed</li>
          </ul>
        </section>
        <section className="mpmb-sg__notmeets">
          <h3 className="mpmb-h3">Does not meet it on its own</h3>
          <ul>
            <li>Low mood, stress, loneliness or worry</li>
            <li>A high score on a wellbeing or mood scale</li>
            <li>Past events described as over</li>
            <li>Vague or ambiguous comments, jokes, or answers that look like testing the form</li>
            <li>Worries about screen time or online habits</li>
          </ul>
        </section>
      </div>
      <h3 className="mpmb-h3">What to do if you come across a concern in the data</h3>
      <ol className="mpmb-sg__principles">
        <li>
          <strong>Stop.</strong> Do not search the data for more about that child.
        </li>
        <li>Tell the project coordinator (Dr Sarmad Ali) and the PI (Professor Faisal Mushtaq) within one working day, giving the study code and the answer.</li>
        <li>The PI decides whether it meets the threshold within two working days of the report, raising it with the University’s research ethics committee within that time if needed.</li>
        <li>If it meets the threshold, the PI asks a member of the research team to use the study code to find the child’s name and school, or does this themselves if no one is available. The name goes only to the PI and the project coordinator.</li>
        <li>The project coordinator tells the school’s DSL by phone or secure email, the same day as the decision.</li>
        <li>Every step is logged, including a decision that the answer does not meet the threshold.</li>
      </ol>
      <p>If something is found long after the session, the same steps apply. The school is best placed to judge whether the risk is still current. If the child has left that school, we tell the school they were at when they took part.</p>

      <H id="sg-flow">Every concern ends with the school’s DSL</H>
      <div className="mpmb-sg__cards">
        <section className="mpmb-card">
          <h3 className="mpmb-h3">In the session</h3>
          <Steps
            final={2}
            steps={[
              'Told or seen in the session',
              'Researcher writes down their words',
              <>
                <strong>School DSL told the same day</strong>
                <br />
                Project coordinator and PI also told the same day
              </>,
            ]}
          />
        </section>
        <section className="mpmb-card">
          <h3 className="mpmb-h3">Found later, in the data during processing or analysis</h3>
          <Steps
            final={4}
            steps={[
              'Noticed in the data after the session',
              'Tell the project coordinator and PI within 1 working day',
              <>
                <strong>Serious risk of harm now?</strong>
                <br />
                PI decides within 2 working days, ethics committee if needed.
                <br />
                <em>No:</em> log it, no further action.
              </>,
              <>
                <em>Yes:</em> team member (or PI) finds the child’s name
              </>,
              <strong>Project coordinator tells the school DSL the same day</strong>,
            ]}
          />
        </section>
      </div>
      <p>A concern raised in the session goes to the school’s DSL the same day; anything found later in the data goes there only if it meets the threshold, decided within two working days.</p>

      <H id="sg-distress">Difficult questions and distress</H>
      <p>Some survey questions are about feelings, mood and wellbeing, and a few young people may find them difficult or upsetting.</p>
      <ul>
        <li>Before the surveys, a researcher will tell the class they can skip any question, take a break or stop, and that answers are not read at the time (also explained in the survey).</li>
        <li>If a young person seems upset, a researcher checks quietly whether they would like a break or to stop, and brings in their teacher if they want.</li>
        <li>
          If they say something that raises a concern, follow the steps in{' '}
          <Button variant="link" onClick={() => jump('sg-session')}>
            Concerns raised during a session
          </Button>
          .
        </li>
        <li>
          Everyone is told where to get support: an adult they trust at home or school, and Childline (<Tel n="0800 1111" />, free, any time).
        </li>
      </ul>

      <H id="sg-roles">Roles</H>
      <div className="mpmb-portal__tablewrap">
        <table className="mpmb-portal__table mpmb-sg__roles">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Who</th>
              <th scope="col">Does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">PI</th>
              <td>
                Professor Faisal Mushtaq
                <br />
                <Mail to="f.mushtaq@leeds.ac.uk" />
              </td>
              <td>Told of every concern; decides on answers found later within two working days, raising them with the ethics committee if needed; tasks a team member to identify the child</td>
            </tr>
            <tr>
              <th scope="row">Project coordinator</th>
              <td>
                Dr Sarmad Ali
                <br />
                <Mail to="S.A.Ali1@leeds.ac.uk" />
              </td>
              <td>Told of every concern; tells the school’s DSL once the PI has decided; keeps the safeguarding log</td>
            </tr>
            <tr>
              <th scope="row">Identifying a child</th>
              <td>A member of the research team tasked by the PI, or the PI if no one is available</td>
              <td>Uses the study code to find a child’s name and school, only when the PI asks</td>
            </tr>
            <tr>
              <th scope="row">Lead researcher for each visit</th>
              <td>Named per visit</td>
              <td>Gets the DSL’s details from the project coordinator, briefs the team, passes on concerns raised in the session</td>
            </tr>
            <tr>
              <th scope="row">School DSL</th>
              <td>Each school</td>
              <td>Decides what happens next under the school’s procedures</td>
            </tr>
          </tbody>
        </table>
      </div>

      <H id="sg-records">Records</H>
      <ul>
        <li>One safeguarding log for the study, kept apart from the research data and open only to the PI and the project coordinator.</li>
        <li>Each entry: date, school, how it arose (in the session, or an answer found later), what was said or found, the decision and why, who was told and when.</li>
        <li>An answer that is followed up is not copied into the log beyond what the decision needs.</li>
        <li>The log is kept for as long as the study’s identifying data, then securely deleted.</li>
      </ul>

      <H id="sg-support">Support for the research team</H>
      <p>Hearing a disclosure, or reading a distressing answer, can be difficult.</p>
      <ul className="mpmb-sg__spaced">
        <li>
          <strong>Talk it through the same day.</strong> Whoever heard or found it debriefs with the project coordinator or the PI, in person or by phone, the same day. This is separate from passing the concern on.
        </li>
        <li>
          <strong>Check in again.</strong> The project coordinator or PI checks in with them a few days later.
        </li>
        <li>
          <strong>Time and space.</strong> They can step back from sessions or from working with the data for a while, without needing to explain why.
        </li>
        <li>
          <strong>Supervision.</strong> PhD students and research assistants can also raise it with their supervisor or line manager (in most cases, this will be the PI, Faisal Mushtaq).
        </li>
        <li>
          <strong>Learning from it.</strong> Once the concern is dealt with, the team will review what happened, without names, to see whether anything in this procedure or the training should change.
        </li>
      </ul>
      <section className="mpmb-card">
        <h3 className="mpmb-h3">Confidential support</h3>
        <dl className="mpmb-sg__support">
          <dt>Employee Assistance Programme (staff)</dt>
          <dd>
            A confidential helpline with accredited counsellors and psychotherapists, 24 hours a day, 365 days a year, by phone or video: <Tel n="0800 316 9337" /> (organisation code G00708082). Also on the Spectrum.Life app and at{' '}
            <a href="https://landg.spectrum.life" target="_blank" rel="noreferrer">
              landg.spectrum.life
            </a>
            ; appointments can be requested by texting Hi to <Tel n="07418 360 046" /> (WhatsApp or SMS). The University is not told who uses it.
          </dd>
          <dt>Workplace Counselling (staff)</dt>
          <dd>Confidential support with work-related challenges.</dd>
          <dt>Occupational Health</dt>
          <dd>
            <Mail to="occupationalhealth@leeds.ac.uk" /> or <Tel n="0113 343 2997" />, 8:30 to 4:30, Monday to Friday.
          </dd>
          <dt>Student Counselling and Wellbeing</dt>
          <dd>
            For students on the team, including PhD students and research assistants: <Tel n="0113 343 4107" />, <Mail to="scw@leeds.ac.uk" />.
          </dd>
          <dt>Samaritans</dt>
          <dd>
            Anyone, free, any time: <Tel n="116 123" />.
          </dd>
        </dl>
        <p className="mpmb-hint">
          All of the University’s services are listed at{' '}
          <a href="https://wsh.leeds.ac.uk/health-wellbeing" target="_blank" rel="noreferrer">
            wsh.leeds.ac.uk/health-wellbeing
          </a>
          .
        </p>
      </section>

      <H id="sg-lab">The adult lab study</H>
      <p>In the social media break study and its control group, participants are adults aged 18 to 24. Their data are stored under a participant ID, and the team does not use them to identify or contact anyone. Support numbers are shown in the chat, and flagged conversations are reviewed for the research and recorded as incidents. The present procedure covers the schools study only.</p>

      <H id="sg-told">What families and schools are told</H>
      <p>The safeguarding process is described in plain words in the session and on the website:</p>
      <ul>
        <li>a slide presented in the session (to be created);</li>
        <li>
          the information sheet for parents and carers, in “Difficult questions and safeguarding”: <Site path="/information/#wellbeing">myphonemybrain.com/information</Site>;
        </li>
        <li>
          the families page, <Site path="/families/">myphonemybrain.com/families</Site>, and the parent form’s summary of the workshop, <Site path="/take-part/consent/">myphonemybrain.com/take-part/consent</Site>;
        </li>
        <li>
          the questions and answers for young people: <Site path="/faq/#young-people">myphonemybrain.com/faq</Site>;
        </li>
        <li>
          the page for schools, under “Safeguarding and approvals”: <Site path="/schools/#safeguarding">myphonemybrain.com/schools</Site>.
        </li>
      </ul>

      <Acknowledge me={me} reload={reload} />
    </article>
  );
}
