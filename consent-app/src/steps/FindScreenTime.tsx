import { StepShell } from '../components/StepShell';
import { Walkthrough } from '../components/Walkthrough';
import { Callout } from '../components/ui/Callout';
import { walkthroughs } from '../config/walkthroughs';
import { useStore } from '../state/context';

/** Illustrated, platform-specific instructions. */
export function FindScreenTime() {
  const { state, dispatch } = useStore();
  const data = walkthroughs[state.donation.platform ?? 'other'];
  const kicker = data.id === 'ios' ? 'On an iPhone' : data.id === 'android' ? 'On an Android phone' : 'On your phone';

  return (
    <StepShell kicker={kicker} title={`Find the ${data.screenName} summary.`} intro={<p>{data.intro}</p>} onContinue={() => dispatch({ type: 'next' })} continueLabel="I have my screenshots" width="wide">
      <Walkthrough data={data} />
      <Callout tone="important" title="Before you share">
        <p>{data.screenshotHint}</p>
        {data.websitesNote && <p>{data.websitesNote}</p>}
        <p>Check the top of each screenshot: notifications or message previews can appear there. On the next screen you can hide any part of an image before it is sent.</p>
      </Callout>
      <p className="mpmb-hint">
        Screenshots are saved in Photos (iPhone) or Gallery (Android). Open your browser again to come back here — your progress is saved on this device while the tab is open.
      </p>
    </StepShell>
  );
}
