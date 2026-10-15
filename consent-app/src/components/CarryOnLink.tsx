import { useEffect, useState } from 'react';
import { getApi } from '../api';
import { finishLink } from '../lib/entryLink';
import { useStore } from '../state/context';
import { ShareLink } from './ShareLink';

/** One request per record, however often the panel is drawn: asking again would make a new key and stop the link already shown. */
const making = new Map<string, Promise<string>>();

/**
 * The link that brings a family back to finish their record (src/steps/Resume.tsx):
 * on the thank-you page whenever the young person's part or the screenshots
 * are still to come, and on the handover screen when the young person isn't
 * there. For the young person (forYoung) it is their own link: it carries a
 * key made for this record (resume.ts, young-link), so it opens their part
 * with nothing to type; if the key cannot be made, it is the link that asks
 * for their birthday instead. It is shown in full, so it can be written down
 * or screenshotted, with ways to send it (ShareLink).
 */
export function CarryOnLink({ referenceCode, childName, forYoung = false }: { referenceCode: string; childName: string; forYoung?: boolean }) {
  const { state, dispatch } = useStore();
  const kept = state.submission.referenceCode === referenceCode ? (state.submission.youngLinkKey ?? null) : null;
  const [failed, setFailed] = useState(false);
  const session = state.session;

  useEffect(() => {
    if (!forYoung || kept || failed || !session) return;
    let live = true;
    if (!making.has(referenceCode)) making.set(referenceCode, getApi().youngLink(session, referenceCode).then((r) => r.key));
    making
      .get(referenceCode)!
      .then((key) => live && dispatch({ type: 'submission', patch: { youngLinkKey: key } }))
      .catch(() => {
        making.delete(referenceCode);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [forYoung, kept, failed, session, referenceCode, dispatch]);

  // No session (nothing sent from this browser) means no key can be made: the birthday link instead.
  if (forYoung && !kept && !failed && session) {
    return (
      <div className="mpmb-card mpmb-carryon" role="region" aria-label={`Send ${childName} their link`}>
        <p className="mpmb-carryon__title">{childName}’s link</p>
        <p className="mpmb-hint" role="status">
          Making {childName}’s link…
        </p>
      </div>
    );
  }

  const own = forYoung && Boolean(kept);
  const url = finishLink(referenceCode, forYoung, own ? kept : null);
  // Sent by the parent, so written in their voice, and saying what the study is: the young person may not have heard of it.
  const message = forYoung
    ? `Hi ${childName}! Your school is taking part in MyPhone/MyBrain, a University of Leeds study about how young people use their phones. I’ve filled in my part. If you want to, you can share your phone’s screen time with them: it’s your choice. ${own ? 'Tap your link to see what it means (it’s just for you, so please don’t pass it on):' : 'Tap the link and type your birthday to see what it means:'}`
    : `To finish ${childName}’s screen time for MyPhone/MyBrain (it asks for their date of birth):`;
  return (
    <div className="mpmb-card mpmb-carryon" role="region" aria-label={forYoung ? `Send ${childName} their link` : 'Carry on later'}>
      <p className="mpmb-carryon__title">{forYoung ? `${childName}’s link` : 'Your link to finish'}</p>
      <p className="mpmb-mono mpmb-carryon__url">{url}</p>
      <ShareLink url={url} message={message} />
      <p className="mpmb-hint">
        {own
          ? `It opens ${childName}’s part straight away, with nothing to sign in. It is just for ${childName}: please send it only to them, not to anyone else.`
          : forYoung
            ? `It opens ${childName}’s part straight away; they only need to type their birthday.`
            : `Or go to the form, choose “Carry on with your reference” and enter ${referenceCode}. You will need ${childName}’s date of birth.`}
      </p>
    </div>
  );
}
