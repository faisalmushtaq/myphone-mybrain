import { finishLink } from '../lib/entryLink';
import { ShareLink } from './ShareLink';

/**
 * The link that brings a family back to finish their record (src/steps/Resume.tsx):
 * on the thank-you page whenever the young person's part or the screenshots
 * are still to come, and on the handover screen when the young person isn't
 * there (forYoung: the link speaks to them and asks only their birthday). It
 * is shown in full, so it can be written down or screenshotted, with ways to
 * send it (ShareLink).
 */
export function CarryOnLink({ referenceCode, childName, forYoung = false }: { referenceCode: string; childName: string; forYoung?: boolean }) {
  const url = finishLink(referenceCode, forYoung);
  // Sent by the parent, so written in their voice, and saying what the study is: the young person may not have heard of it.
  const message = forYoung
    ? `Hi ${childName}! Your school is taking part in MyPhone/MyBrain, a University of Leeds study about how young people use their phones. I’ve filled in my part. If you want to, you can share your phone’s screen time with them: it’s your choice. Tap the link and type your birthday to see what it means:`
    : `To finish ${childName}’s screen time for MyPhone/MyBrain (it asks for their date of birth):`;
  return (
    <div className="mpmb-card mpmb-carryon" role="region" aria-label={forYoung ? `Send ${childName} their link` : 'Carry on later'}>
      <p className="mpmb-carryon__title">{forYoung ? `${childName}’s link` : 'Your link to finish'}</p>
      <p className="mpmb-mono mpmb-carryon__url">{url}</p>
      <ShareLink url={url} message={message} />
      <p className="mpmb-hint">
        {forYoung
          ? `It opens ${childName}’s part straight away; they only need to type their birthday.`
          : `Or go to the form, choose “Carry on with your reference” and enter ${referenceCode}. You will need ${childName}’s date of birth.`}
      </p>
    </div>
  );
}
