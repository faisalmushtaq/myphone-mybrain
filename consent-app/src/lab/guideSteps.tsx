/** The illustrated steps shared by the screenshots step and the app-data guide, plus the small pieces that move between sections. */
import androidShot from '../assets/lab-guide/screentime-android.svg';
import iphone1 from '../assets/lab-guide/screentime-iphone-1.jpg';
import iphone2 from '../assets/lab-guide/screentime-iphone-2.jpg';
import iphone3 from '../assets/lab-guide/screentime-iphone-3.jpg';
import iphone4 from '../assets/lab-guide/screentime-iphone-4.jpg';
import iphone5 from '../assets/lab-guide/screentime-iphone-5.jpg';
import tiktok1 from '../assets/lab-guide/tiktok-1.jpg';
import tiktok2 from '../assets/lab-guide/tiktok-2.jpg';
import tiktok3 from '../assets/lab-guide/tiktok-3.jpg';
import tiktok4 from '../assets/lab-guide/tiktok-4.jpg';
import tiktok5 from '../assets/lab-guide/tiktok-5.jpg';
import tiktok6 from '../assets/lab-guide/tiktok-6.jpg';
import youtube1 from '../assets/lab-guide/youtube-1.png';
import youtube2 from '../assets/lab-guide/youtube-2.png';
import youtube3 from '../assets/lab-guide/youtube-3.png';
import youtube4 from '../assets/lab-guide/youtube-4.png';
import type { LabPhone, LabPlatform } from '../api/types';
import instagram1 from '../assets/lab-guide/instagram-1.jpg';
import instagram2 from '../assets/lab-guide/instagram-2.jpg';
import instagram3 from '../assets/lab-guide/instagram-3.jpg';
import instagram4 from '../assets/lab-guide/instagram-4.jpg';
import { Button } from '../components/ui/Button';
export interface GuideStep {
  title: string;
  text: string;
  image?: string;
  alt?: string;
}

export const screenTimeIphone: GuideStep[] = [
  { title: 'Open Screen Time', text: 'In Settings, scroll down and tap Screen Time.', image: iphone1, alt: 'iPhone Settings with Screen Time highlighted' },
  { title: 'See all activity', text: 'Tap See All App & Website Activity.', image: iphone2, alt: 'Screen Time page with See All App & Website Activity highlighted' },
  { title: 'Screenshot the week view', text: 'On the Week tab, take a screenshot. It shows your daily average, categories and total screen time.', image: iphone3, alt: 'Week view of Screen Time' },
  { title: 'Screenshot the app list', text: 'Scroll to Most Used, tap Show More, and screenshot the list so TikTok, YouTube and the rest appear with their times.', image: iphone4, alt: 'Most Used list with Show More' },
  { title: 'Screenshot the day view', text: 'Tap the Day tab and screenshot that too.', image: iphone5, alt: 'Day view of Screen Time' },
];
export const tiktokSteps: GuideStep[] = [
  { title: 'Settings and privacy', text: 'Go to your Profile, tap the menu in the top right, then Settings and privacy.', image: tiktok1, alt: 'TikTok profile menu' },
  { title: 'Account', text: 'Tap Account.', image: tiktok2, alt: 'TikTok settings with Account highlighted' },
  { title: 'Download your data', text: 'Tap Download your data.', image: tiktok3, alt: 'Account settings with Download your data highlighted' },
  { title: 'Choose JSON', text: 'Under File format, choose JSON (not TXT). That is the format this page can read.', image: tiktok4, alt: 'File format options with JSON highlighted' },
  { title: 'Choose what to include and request', text: 'Under Select data to download, tap Select all, or tick only what you are happy to share; you may leave Direct Messages unticked. Then tap Request data.', image: tiktok5, alt: 'Data selection and Request data button' },
  { title: 'Download', text: 'Open the Download data tab. When the file is ready, tap Download (the link works for four days). On an iPhone it is saved in the Files app, under Downloads; on Android, in Downloads. Don’t open or unzip it: come back to this page and choose it.', image: tiktok6, alt: 'Download data tab with the file ready' },
];
export const androidSteps: GuideStep[] = [
  { title: 'Digital Wellbeing', text: 'Open Settings, then Digital Wellbeing & parental controls. Screenshot the chart, then scroll to the app list at the bottom and screenshot that. Your screen may look a little different on Samsung, Xiaomi, Pixel and others.', image: androidShot, alt: 'Illustration of the Android Digital Wellbeing screen' },
];
export const instagramSteps: GuideStep[] = [
  { title: 'Accounts Centre', text: 'Open Instagram, tap the menu at the top right of your profile to open Settings and activity, then tap Accounts Centre at the top.', image: instagram1, alt: 'Instagram Settings and activity with Accounts Centre at the top' },
  { title: 'Your information and permissions', text: 'In Accounts Centre, tap Your information and permissions.', image: instagram2, alt: 'Accounts Centre with Your information and permissions' },
  { title: 'Export your information', text: 'Tap Export your information.', image: instagram3, alt: 'Export your information option' },
  { title: 'Create export', text: 'Tap Create export, choose Export to device and select your Instagram profile. To keep the file small, choose Customise information and leave out your photos, videos and messages: the study only reads what you liked, viewed, watched and searched. Set Format to JSON and Date range to All time, and confirm. Instagram tells you when the file is ready; save the ZIP and don’t unzip it.', image: instagram4, alt: 'Export your information page with Create export' },
];
export const phones: { id: LabPhone; name: string }[] = [
  { id: 'iphone', name: 'iPhone' },
  { id: 'android', name: 'Android' },
];
export const youtubeSteps: GuideStep[] = [
  { title: 'Select YouTube only', text: 'Go to takeout.google.com in a web browser. Click Deselect all, then scroll down and tick only YouTube and YouTube Music. Click All YouTube data included, choose Deselect all, tick only history and subscriptions, and click OK: leaving out your videos keeps the file small. Click Multiple formats and change history from HTML to JSON, click OK, then Next step.', image: youtube1, alt: 'Google Takeout with YouTube selected' },
  { title: 'Create the export', text: 'Set Transfer to “Send download link via email”, Frequency “Export once”, File type .zip. Click Create export.', image: youtube2, alt: 'Takeout export options' },
  { title: 'Open the email', text: 'Wait for Google’s email “Your Google data is ready to download”, then click Manage Google Takeout request.', image: youtube3, alt: 'Email from Google Takeout' },
  { title: 'Download', text: 'On the export page, click Download and save the ZIP file.', image: youtube4, alt: 'Takeout download page' },
];
export const apps: { id: LabPlatform; name: string; where: string; steps: GuideStep[] }[] = [
  { id: 'tiktok', name: 'TikTok', where: 'In the TikTok app on your phone.', steps: tiktokSteps },
  { id: 'youtube', name: 'YouTube', where: 'In a web browser, signed in to the Google account you use for YouTube.', steps: youtubeSteps },
  { id: 'instagram', name: 'Instagram', where: 'In the Instagram app on your phone.', steps: instagramSteps },
];

export function Steps({ steps }: { steps: GuideStep[] }) {
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
export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

export function NextLink({ to, onClick, children }: { to?: string; onClick?: () => void; children: string }) {
  return (
    <p className="mpmb-guide-next">
      <Button variant="link" onClick={() => (onClick ? onClick() : to && jumpTo(to))}>
        {children} {onClick ? '→' : '↓'}
      </Button>
    </p>
  );
}
