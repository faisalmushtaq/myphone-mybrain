import { useState } from 'react';
import androidShot from '../../assets/lab-guide/screentime-android.svg';
import iphone1 from '../../assets/lab-guide/screentime-iphone-1.jpg';
import iphone2 from '../../assets/lab-guide/screentime-iphone-2.jpg';
import iphone3 from '../../assets/lab-guide/screentime-iphone-3.jpg';
import iphone4 from '../../assets/lab-guide/screentime-iphone-4.jpg';
import iphone5 from '../../assets/lab-guide/screentime-iphone-5.jpg';
import tiktok1 from '../../assets/lab-guide/tiktok-1.jpg';
import tiktok2 from '../../assets/lab-guide/tiktok-2.jpg';
import tiktok3 from '../../assets/lab-guide/tiktok-3.jpg';
import tiktok4 from '../../assets/lab-guide/tiktok-4.jpg';
import tiktok5 from '../../assets/lab-guide/tiktok-5.jpg';
import tiktok6 from '../../assets/lab-guide/tiktok-6.jpg';
import youtube1 from '../../assets/lab-guide/youtube-1.png';
import youtube2 from '../../assets/lab-guide/youtube-2.png';
import youtube3 from '../../assets/lab-guide/youtube-3.png';
import youtube4 from '../../assets/lab-guide/youtube-4.png';
import type { LabPhone } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { labStudy } from '../config';
import { LabShell } from '../LabShell';
import { useLab } from '../store';

interface GuideStep {
  title: string;
  text: string;
  image?: string;
  alt?: string;
}

const screenTimeIphone: GuideStep[] = [
  { title: 'Open Screen Time', text: 'In Settings, scroll down and tap Screen Time.', image: iphone1, alt: 'iPhone Settings with Screen Time highlighted' },
  { title: 'See all activity', text: 'Tap See All App & Website Activity.', image: iphone2, alt: 'Screen Time page with See All App & Website Activity highlighted' },
  { title: 'Screenshot the week view', text: 'On the Week tab, take a screenshot. It shows your daily average, categories and total screen time.', image: iphone3, alt: 'Week view of Screen Time' },
  { title: 'Screenshot the app list', text: 'Scroll to Most Used, tap Show More, and screenshot the list so TikTok, YouTube and the rest appear with their times.', image: iphone4, alt: 'Most Used list with Show More' },
  { title: 'Screenshot the day view', text: 'Tap the Day tab and screenshot that too.', image: iphone5, alt: 'Day view of Screen Time' },
];
const tiktokSteps: GuideStep[] = [
  { title: 'Settings and privacy', text: 'Go to your Profile, tap the menu in the top right, then Settings and privacy.', image: tiktok1, alt: 'TikTok profile menu' },
  { title: 'Account', text: 'Tap Account.', image: tiktok2, alt: 'TikTok settings with Account highlighted' },
  { title: 'Download your data', text: 'Tap Download your data.', image: tiktok3, alt: 'Account settings with Download your data highlighted' },
  { title: 'Choose JSON', text: 'Under File format, choose JSON (not TXT). That is the format this page can read.', image: tiktok4, alt: 'File format options with JSON highlighted' },
  { title: 'Choose what to include and request', text: 'Under Select data to download, tap Select all, or tick only what you are happy to share; you may leave Direct Messages unticked. Then tap Request data.', image: tiktok5, alt: 'Data selection and Request data button' },
  { title: 'Download', text: 'Open the Download data tab. When the file is ready, tap Download. The link works for four days.', image: tiktok6, alt: 'Download data tab with the file ready' },
];
const androidSteps: GuideStep[] = [
  { title: 'Digital Wellbeing', text: 'Open Settings, then Digital Wellbeing & parental controls. Screenshot the chart, then scroll to the app list at the bottom and screenshot that. Your screen may look a little different on Samsung, Xiaomi, Pixel and others.', image: androidShot, alt: 'Illustration of the Android Digital Wellbeing screen' },
];
const phones: { id: LabPhone; name: string }[] = [
  { id: 'iphone', name: 'iPhone' },
  { id: 'android', name: 'Android' },
];
const youtubeSteps: GuideStep[] = [
  { title: 'Select YouTube only', text: 'Go to takeout.google.com in a web browser. Click Deselect all, then scroll down and tick only YouTube and YouTube Music. Click Multiple formats and change history from HTML to JSON, click OK, then Next step.', image: youtube1, alt: 'Google Takeout with YouTube selected' },
  { title: 'Create the export', text: 'Set Transfer to “Send download link via email”, Frequency “Export once”, File type .zip. Click Create export.', image: youtube2, alt: 'Takeout export options' },
  { title: 'Open the email', text: 'Wait for Google’s email “Your Google data is ready to download”, then click Manage Google Takeout request.', image: youtube3, alt: 'Email from Google Takeout' },
  { title: 'Download', text: 'On the export page, click Download and save the ZIP file.', image: youtube4, alt: 'Takeout download page' },
];

function Steps({ steps }: { steps: GuideStep[] }) {
  return (
    <ol className="mpmb-guide-steps" role="list">
      {steps.map((s, i) => (
        <li key={s.title}>
          <div className="mpmb-guide-steps__text">
            <span className="mpmb-guide-steps__n" aria-hidden="true">
              {i + 1}
            </span>
            <h3 className="mpmb-h3">{s.title}</h3>
            <p>{s.text}</p>
          </div>
          {s.image && <img src={s.image} alt={s.alt ?? ''} loading="lazy" />}
        </li>
      ))}
    </ol>
  );
}

/** Scrolls to a section and moves focus there, so the next-step links work for keyboard and screen-reader users too. */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

function NextLink({ to, onClick, children }: { to?: string; onClick?: () => void; children: string }) {
  return (
    <p className="mpmb-guide-next">
      <Button variant="link" onClick={() => (onClick ? onClick() : to && jumpTo(to))}>
        {children} {onClick ? '→' : '↓'}
      </Button>
    </p>
  );
}

/** How to get the three things the study asks for. Shareable before the lab visit; the files take a while to arrive. */
export function LabGuide() {
  const { state, dispatch } = useLab();
  const [later, setLater] = useState(false);
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const phone = state.phone;

  const choosePhone = (p: LabPhone) => {
    dispatch({ type: 'phone', phone: p });
    window.setTimeout(() => jumpTo(`guide-${p}`), 60);
  };

  const next = () => {
    if (ready) dispatch({ type: 'go-to', stepId: 'clean' });
    else {
      dispatch({ type: 'code', code: state.code, returning: Boolean(state.code) });
      dispatch({ type: 'go-to', stepId: 'participant-id' });
    }
  };

  return (
    <LabShell kicker="Get your data" title="Download your data." intro={<p>Three things: screenshots of your phone’s screen-time summary, your TikTok data, and your YouTube data. The exports can take from a few minutes to a few days to arrive, so start now and come back when they are ready.</p>} onContinue={next} continueLabel={ready ? 'I have my files' : 'I have my files: enter my code'} width="wide" secondaryAction={<Button variant="ghost" onClick={() => setLater(true)}>I’ll come back later</Button>}>
      {later && (
        <Callout tone="info" role="status">
          <p>
            Come back to this page when your files have arrived{state.codeConfirmed ? <>, and enter your participant code <strong className="mpmb-mono">{state.code}</strong> if asked</> : ''}. Nothing more is needed now.
          </p>
        </Callout>
      )}
      <Callout tone="info">
        <p>
          <strong>Before you start:</strong> make sure you are logged in to your own account. When a format option appears, always choose <strong>JSON</strong>. You do not need to share everything: you can untick items when you request the data, and you will choose again, item by item, before anything is sent.
        </p>
      </Callout>

      <section aria-labelledby="guide-screentime">
        <h2 className="mpmb-h2" id="guide-screentime" tabIndex={-1}>
          1. Screen-time screenshots
        </h2>
        <p>Take several screenshots, not just the first screen: scroll down so the chart, the totals and the full app list (including anything under “Show more”) are all captured.</p>
        <fieldset className="mpmb-field">
          <legend className="mpmb-label">Which phone do you have?</legend>
          <div className="mpmb-chips" role="presentation">
            {phones.map((p) => (
              <label key={p.id} className={`mpmb-chip${phone === p.id ? ' is-selected' : ''}`} htmlFor={`lab-phone-${p.id}`}>
                <input id={`lab-phone-${p.id}`} type="radio" name="lab-phone" value={p.id} className="mpmb-choice__input" checked={phone === p.id} onChange={() => choosePhone(p.id)} />
                <span className="mpmb-choice__dot" aria-hidden="true" />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        {phone === 'iphone' && (
          <div id="guide-iphone" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On iPhone</h3>
            <p className="mpmb-hint">To take a screenshot, press the Side button and Volume Up together.</p>
            <Steps steps={screenTimeIphone} />
          </div>
        )}
        {phone === 'android' && (
          <div id="guide-android" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On Android</h3>
            <p className="mpmb-hint">To take a screenshot, press Power and Volume Down together.</p>
            <Steps steps={androidSteps} />
          </div>
        )}
        {phone && <NextLink to="guide-tiktok">Next: get your TikTok data</NextLink>}
      </section>

      <section aria-labelledby="guide-tiktok">
        <h2 className="mpmb-h2" id="guide-tiktok" tabIndex={-1}>
          2. TikTok
        </h2>
        <p>In the TikTok app on your phone.</p>
        <Steps steps={tiktokSteps} />
        <NextLink to="guide-youtube">Next: get your YouTube data</NextLink>
      </section>

      <section aria-labelledby="guide-youtube">
        <h2 className="mpmb-h2" id="guide-youtube" tabIndex={-1}>
          3. YouTube
        </h2>
        <p>In a web browser, signed in to the Google account you use for YouTube.</p>
        <Steps steps={youtubeSteps} />
        <NextLink onClick={next}>{ready ? 'Continue: I have my files' : 'Continue: enter my code'}</NextLink>
      </section>

      <Callout tone="info">
        <p>
          <strong>Then:</strong> with the ZIP files and screenshots on this device, press “I have my files”. You will see exactly what each file contains, untick anything you would rather keep private, and only then send it. The reading and cleaning happen on your own device; nothing is uploaded until you say so. Large YouTube exports work best on a laptop.
        </p>
      </Callout>
      <p className="mpmb-hint">
        Platform menus change from time to time, so a button may sit in a slightly different place. If you get stuck, contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>.
      </p>
    </LabShell>
  );
}
