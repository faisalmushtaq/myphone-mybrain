import { schools } from '../config/schools';
import { useStore } from '../state/context';
import { ShareLink } from './ShareLink';

/**
 * For an under-16 whose parent or carer isn't with them: they must not fill
 * in the parent's part themselves, so this offers a link that opens the
 * form for the parent on their own phone (with the school filled in when it
 * is known), with the same ways to send it as the young person's link.
 * Nothing the young person typed is saved before the parent says yes, so the
 * parent starts afresh; at the end of their part they send the young person
 * a link of their own.
 */
export function ParentLinkPanel({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { state } = useStore();
  const slug = schools.find((s) => s.id === state.identity.schoolId)?.slug;
  const url = `${window.location.origin}/take-part/consent/?who=parent${slug ? `&school=${slug}` : ''}`;
  // Sent by the young person, so in their voice, and saying what the study is: the parent may not have heard of it.
  const message =
    'Hi! My school is taking part in MyPhone/MyBrain, a University of Leeds study about how young people use their phones. I’d like to share my phone’s screen time with them, and because I’m under 16 they need your OK first. It takes about 5 minutes. Please tap the link:';

  return (
    <div className={`mpmb-parentlink mpmb-parentlink--${tone}`} role="region" aria-label="Send your parent or carer a link">
      <p className="mpmb-parentlink__title">Send your parent or carer a link.</p>
      <p>Only your parent or carer can do their part, so please don’t fill it in for them. They can do it on their own phone, whenever suits them. When they have finished, they send you a link, and you do your part.</p>
      <p className="mpmb-mono mpmb-carryon__url">{url}</p>
      <ShareLink url={url} message={message} />
      <p className="mpmb-parentlink__note">Or do it together another time. Don’t want to share your screen time? You don’t need to fill anything in. Nobody will mind.</p>
    </div>
  );
}
