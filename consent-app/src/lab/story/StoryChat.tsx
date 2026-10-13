import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getApi } from '../../api';
import type { LabStoryChatRequest, LabStoryChatResponse, LabStoryPayload, StoryChatScreens } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { announce } from '../../lib/announce';
import { describeError, labClientInfo, labSession } from '../api';
import { LabShell } from '../LabShell';
import { labMyStory, type StoryPhase } from '../mystory';
import { useLab } from '../store';

type Stage = 'ready' | 'interview' | 'choose' | 'rate' | 'adapt' | 'stopped';
interface Bubble {
  from: 'sam' | 'me';
  text: string;
}

export interface ChatFinished {
  storyId: string;
  receivedAt: string;
  story: string;
  debriefText: string;
  debriefLede: string;
}

/**
 * MyStory as a chat with Sam (src/lab/mystory.ts, mode 'chat'): the MySelf
 * micro-narrative protocol. Sam asks the phase's questions one at a time;
 * then three short retellings of what was said, to pick from; a 0 to 10
 * rating of how well it fits; and, below full marks, a chance to edit it
 * directly or ask Sam to change it. The conversation runs on the server
 * (firebase/functions/src/storyChat.ts), which holds the protocol and the
 * key: this page sends only what the participant types and chooses, and
 * every word on screen that is not theirs comes from the protocol file.
 *
 * Nothing starts until they press Start, so opening the page costs nothing.
 * If the chat is not set up, or cannot start, onUnavailable hands over to
 * MyStory's own form.
 */
export function StoryChat({ source, onUnavailable, onFinished, onLeave, leaveLabel }: { source: LabStoryPayload['source']; onUnavailable: () => void; onFinished: (done: ChatFinished) => void; onLeave: (() => void) | null; leaveLabel: string }) {
  const { state, dispatch } = useLab();
  const phase = state.phase as StoryPhase;
  const [stage, setStage] = useState<Stage>('ready');
  const [screens, setScreens] = useState<StoryChatScreens | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [candidates, setCandidates] = useState<{ index: number; text: string }[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [story, setStory] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [request, setRequest] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const name = screens?.characterName ?? 'Sam';

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [bubbles.length, busy, stage]);

  const send = async (req: LabStoryChatRequest): Promise<LabStoryChatResponse | null> => {
    setBusy(true);
    setError(null);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      return await getApi().labStoryChat(session, req);
    } catch (e) {
      setError({ message: describeError(e, 'your story'), retry: () => void run(req) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const finish = (res: LabStoryChatResponse, fallbackStory: string) => {
    onFinished({ storyId: res.storyId ?? '', receivedAt: res.receivedAt ?? new Date().toISOString(), story: res.story ?? fallbackStory, debriefText: screens?.debriefText ?? '', debriefLede: screens?.debriefLede ?? '' });
  };

  /** Applies what the server said to the screen. */
  const apply = (res: LabStoryChatResponse, req: LabStoryChatRequest) => {
    switch (res.stage) {
      case 'interview':
        setBubbles((b) => [...b, { from: 'sam', text: res.reply ?? '' }]);
        setStage('interview');
        announce(`${name}: ${res.reply ?? ''}`);
        window.requestAnimationFrame(() => inputRef.current?.focus());
        break;
      case 'choose':
        setBubbles((b) => [...b, { from: 'sam', text: screens?.outro ?? '' }]);
        setCandidates(res.candidates ?? []);
        setStage('choose');
        announce(screens?.selectText ?? 'Choose a story.');
        break;
      case 'rate':
        setStory(res.story ?? '');
        setStage('rate');
        break;
      case 'adapt':
        if (req.action === 'adapt') {
          setNote(res.failed ? `${name} couldn’t make that change just now. You can edit it yourself, or try again.` : res.unchanged ? `${name} couldn’t make that change from what you said, so the story is as it was. You can edit it yourself.` : res.limit ? 'That’s as many changes as Sam can make. You can still edit it yourself.' : `${name} has rewritten it. Check it reads right.`);
          if (!res.failed && !res.limit && res.story && res.story !== story) {
            setHistory((h) => [...h, story]);
            setStory(res.story);
            setRequest('');
          }
        } else setStory(res.story ?? story);
        setStage('adapt');
        break;
      case 'stopped':
        setBubbles((b) => [...b, { from: 'sam', text: res.text ?? screens?.fallbackText ?? '' }]);
        setStage('stopped');
        break;
      case 'done':
        finish(res, story);
        break;
    }
  };

  const run = async (req: LabStoryChatRequest) => {
    const res = await send(req);
    if (res) apply(res, req);
  };

  const start = async () => {
    const res = await send({ action: 'start', participantCode: state.code, phase, source, checkInId: state.flow === 'checkin' ? state.checkIn.checkInId : null, client: labClientInfo() });
    if (!res) return;
    if (!res.available || !res.chatId || !res.screens) {
      onUnavailable();
      return;
    }
    setChatId(res.chatId);
    setScreens(res.screens);
    setBubbles([
      { from: 'sam', text: res.screens.introAndConsent },
      { from: 'sam', text: res.screens.intro },
      { from: 'sam', text: res.reply ?? '' },
    ]);
    setStage('interview');
    announce(`${res.screens.characterName}: ${res.reply ?? ''}`);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const reply = () => {
    const text = draft.trim();
    if (!text || !chatId || busy) return;
    setBubbles((b) => [...b, { from: 'me', text }]);
    setDraft('');
    void run({ action: 'reply', chatId, text });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      reply();
    }
  };

  const leaveButton = onLeave ? (
    <Button variant="ghost" onClick={onLeave}>
      {leaveLabel}
    </Button>
  ) : null;

  if (stage === 'ready') {
    return (
      <LabShell kicker={labMyStory.name} title="A short chat about your break." intro={<p>MyStory is a chat with Sam, an AI chatbot the research team set up for this study. Sam asks you a few questions, one at a time, then writes back what it heard in three different ways. You pick the one that fits best and can change anything that isn’t right. It takes about ten minutes.</p>} hideContinue hideBack width="wide" secondaryAction={leaveButton}>
        <Disclosure summary="About Sam">
          <ul>
            <li>Sam is an AI, not a person. Nobody is reading this as you type.</li>
            <li>What you type is sent to the AI service (OpenAI) to write Sam’s replies, with your participant ID and never your name. The service is asked not to keep it.</li>
            <li>The conversation and your story are kept for the research with your participant ID, never your name.</li>
            <li>There are no right answers. Please leave out names and anything that could identify someone.</li>
          </ul>
        </Disclosure>
        {error && (
          <Callout tone="warning" role="alert">
            <p>{error.message}</p>
          </Callout>
        )}
        <div className="mpmb-actions">
          <Button variant="primary" arrow loading={busy} onClick={() => void start()}>
            Start the chat
          </Button>
          <Button variant="link" onClick={onUnavailable}>
            I’d rather write my story myself
          </Button>
        </div>
      </LabShell>
    );
  }

  const conversation = (
    <div className="mpmb-chat" role="log" aria-live="polite" aria-label={`Your chat with ${name}`}>
      {bubbles
        .filter((b) => b.text)
        .map((b, i) => (
          <div key={i} className={`mpmb-chat__row mpmb-chat__row--${b.from}`}>
            {b.from === 'sam' && (
              <span className="mpmb-chat__avatar" aria-hidden="true">
                {name.slice(0, 1)}
              </span>
            )}
            <p className={`mpmb-chat__bubble mpmb-chat__bubble--${b.from}`}>
              <span className="mpmb-sr-only">{b.from === 'sam' ? `${name}: ` : 'You: '}</span>
              {b.text}
            </p>
          </div>
        ))}
      {busy && stage === 'interview' && (
        <div className="mpmb-chat__row mpmb-chat__row--sam">
          <span className="mpmb-chat__avatar" aria-hidden="true">
            {name.slice(0, 1)}
          </span>
          <p className="mpmb-chat__bubble mpmb-chat__bubble--sam mpmb-chat__typing">
            <span className="mpmb-sr-only">{name} is writing…</span>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </p>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );

  const errorBox = error && (
    <Callout tone="warning" role="alert">
      <p>{error.message}</p>
      <div className="mpmb-callout__actions">
        <Button variant="secondary" onClick={error.retry}>
          Try again
        </Button>
      </div>
    </Callout>
  );

  return (
    <LabShell kicker={labMyStory.name} title={stage === 'interview' || stage === 'stopped' ? `Chatting with ${name}` : stage === 'choose' ? (screens?.selectText ?? 'Pick one') : stage === 'rate' ? (screens?.rateText ?? 'How close is this?') : (screens?.adaptText ?? 'What would you change?')} hideContinue hideBack width="wide" secondaryAction={stage === 'interview' ? leaveButton : null}>
      {(stage === 'interview' || stage === 'stopped') && conversation}
      {errorBox}

      {stage === 'interview' && (
        <div className="mpmb-chat__composer">
          <label className="mpmb-sr-only" htmlFor="chat-input">
            Your reply to {name}
          </label>
          <textarea id="chat-input" ref={inputRef} className="mpmb-input mpmb-input--area mpmb-chat__input" rows={2} maxLength={screens?.maxChars ?? 2000} value={draft} placeholder="Type your reply…" onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} disabled={busy} />
          <Button variant="primary" onClick={reply} loading={busy} disabled={!draft.trim()}>
            Send
          </Button>
        </div>
      )}
      {stage === 'interview' && screens?.disclosure && <p className="mpmb-hint">{screens.disclosure}</p>}

      {stage === 'stopped' && (
        <div className="mpmb-actions">
          <Button variant="primary" arrow loading={busy} onClick={() => chatId && void run({ action: 'finish', chatId, story: '' })}>
            Finish
          </Button>
          <p className="mpmb-hint">What you wrote is kept as your story for this time.</p>
        </div>
      )}

      {stage === 'choose' && (
        <>
          {screens?.outro && <p className="mpmb-lead">{screens.outro}</p>}
          {screens?.selectLede && <p className="mpmb-hint">{screens.selectLede}</p>}
          <fieldset className="mpmb-choice mpmb-choice--stack">
            <legend className="mpmb-sr-only">{screens?.selectText}</legend>
            <div className="mpmb-choice__options">
              {candidates.map((c, i) => (
                <label key={c.index} className={`mpmb-choice__option mpmb-chat__candidate${picked === c.index ? ' is-selected' : ''}`} htmlFor={`chat-candidate-${c.index}`}>
                  <input id={`chat-candidate-${c.index}`} type="radio" name="chat-candidate" className="mpmb-choice__input" checked={picked === c.index} onChange={() => setPicked(c.index)} />
                  <span className="mpmb-choice__dot" aria-hidden="true" />
                  <span>
                    <strong>Version {i + 1}</strong>
                    <br />
                    {c.text}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mpmb-actions">
            <Button variant="primary" arrow loading={busy} disabled={picked === null} onClick={() => chatId && picked !== null && void run({ action: 'choose', chatId, index: picked })}>
              This one
            </Button>
          </div>
        </>
      )}

      {stage === 'rate' && (
        <>
          <blockquote className="mpmb-chat__story">{story}</blockquote>
          <p className="mpmb-hint" id="chat-rate-hint">
            {screens?.rateLede}
          </p>
          <div className="mpmb-chat__scale" role="group" aria-label={screens?.rateText} aria-describedby="chat-rate-hint">
            {Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" className="mpmb-chat__scale-option" disabled={busy} onClick={() => chatId && void run({ action: 'rate', chatId, rating: n })}>
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      {stage === 'adapt' && (
        <>
          <p className="mpmb-hint">{screens?.adaptLede}</p>
          <label className="mpmb-label" htmlFor="chat-story">
            Your story
          </label>
          <textarea id="chat-story" className="mpmb-input mpmb-input--area mpmb-chat__story-edit" rows={7} value={story} onChange={(e) => setStory(e.target.value)} />
          {note && (
            <p className="mpmb-hint" role="status">
              {note}
            </p>
          )}
          {history.length > 0 && (
            <Button
              variant="link"
              onClick={() => {
                setStory(history[history.length - 1]!);
                setHistory((h) => h.slice(0, -1));
                setNote('The previous version is back.');
              }}
            >
              Put the previous version back
            </Button>
          )}
          <div className="mpmb-chat__ask">
            <label className="mpmb-label" htmlFor="chat-request">
              Or ask {name} to change it
            </label>
            <div className="mpmb-chat__composer">
              <textarea id="chat-request" className="mpmb-input mpmb-input--area mpmb-chat__input" rows={2} value={request} placeholder="For example: it was my brother" onChange={(e) => setRequest(e.target.value)} disabled={busy} />
              <Button variant="secondary" loading={busy} disabled={!request.trim()} onClick={() => chatId && void run({ action: 'adapt', chatId, request: request.trim(), story })}>
                Ask {name}
              </Button>
            </div>
          </div>
          <div className="mpmb-actions">
            <Button variant="primary" arrow loading={busy} disabled={!story.trim()} onClick={() => chatId && void run({ action: 'finish', chatId, story: story.trim() })}>
              Keep this story
            </Button>
          </div>
        </>
      )}
    </LabShell>
  );
}
