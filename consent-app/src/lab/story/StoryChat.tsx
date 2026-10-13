import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
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
import { chatCharacter, chatSupport, withFirstName } from './chatProtocol';
import { base64Of, LIVE_BARS, useVoice, type VoiceNote } from './useVoice';

type Stage = 'ready' | 'interview' | 'choose' | 'rate' | 'adapt' | 'stopped';
interface Bubble {
  from: 'bot' | 'me';
  text: string;
  /** A retelling, shown as a story card rather than a message. */
  story?: boolean;
  /** A short note from the app, centred in the thread. */
  note?: boolean;
  /** Spoken answers: the recordings, played back from this device only. */
  voice?: VoiceNote[];
}

/**
 * How long Remi's "…" stays up before a message, as in MySelf's MyStory
 * (apps/mystory-lab/web/main.ts, typingPause): about as long as it takes to
 * type it on a phone, nine milliseconds a character over a half-second floor,
 * and never more than 3.8 seconds. A paragraph landing whole the moment a
 * button is pressed is the clearest sign that nothing typed it.
 */
export function typingPause(text: string): number {
  return Math.min(3800, 500 + text.trim().length * 9);
}
/** A story, or one of the three versions, is handed over rather than typed: a shorter pause. */
const handOverPause = (text: string): number => Math.min(1400, 400 + text.trim().length * 2);
const BETWEEN_MS = 320;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export interface ChatFinished {
  storyId: string;
  receivedAt: string;
  story: string;
  debriefText: string;
  /** How it was filed; stopped-early and model-unavailable mean their own words, not a retelling. */
  ending: string;
}

/**
 * MyStory as a chat with the protocol's character (Remi, in the team's
 * files; src/lab/mystory.ts, mode 'chat'): the MySelf micro-narrative
 * protocol. It asks the phase's questions one at a time; then three short
 * retellings of what was said, to pick from; a 0 to 10 rating of how well it
 * fits; and, below full marks, a chance to edit it directly or ask for a
 * change. The conversation runs on the server
 * (firebase/functions/src/storyChat.ts), which holds the protocol and the
 * key: this page sends only what the participant types and chooses, and
 * every word on screen that is not theirs comes from the protocol file.
 *
 * Once started, the chat takes the whole screen, like a messaging app: a bar
 * with the character's name and a Help button (the support numbers), the
 * conversation, and the reply box at the bottom. Choosing, rating and
 * changing the story all happen in the conversation. Closing it goes back to
 * the start page, where the chat can be carried on.
 *
 * Nothing starts until they press Start, so opening the page costs nothing.
 * If the chat is not set up, or cannot start, onUnavailable hands over to
 * MyStory's own form.
 */
export function StoryChat({ source, onUnavailable, onFinished, onLeave, leaveLabel }: { source: LabStoryPayload['source']; onUnavailable: () => void; onFinished: (done: ChatFinished) => void; onLeave: (() => void) | null; leaveLabel: string }) {
  const { state, dispatch } = useLab();
  const phase = state.phase as StoryPhase;
  const [stage, setStage] = useState<Stage>('ready');
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [screens, setScreens] = useState<StoryChatScreens | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Remi is "typing": the dots are up before a message lands. */
  const [typing, setTyping] = useState(false);
  const [shownCandidates, setShownCandidates] = useState(0);
  /** When the last request went to the server: that wait counts towards the first message's pause. */
  const askedAt = useRef(0);
  /** Waiting on the server, or Remi still "typing": nothing can be sent. */
  const working = busy || typing;
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [candidates, setCandidates] = useState<{ index: number; text: string }[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [story, setStory] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [heard, setHeard] = useState(false);
  const [voiceTrouble, setVoiceTrouble] = useState<string | null>(null);
  const pendingNotes = useRef<VoiceNote[]>([]);
  const draftRef = useRef('');
  draftRef.current = draft;
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const character = chatCharacter(phase);
  const name = screens?.characterName ?? character.name;
  // Filled in on this device only; never sent anywhere.
  const say = (text: string) => withFirstName(text, state.codeParts.firstName);
  const bot = (text: string, extra: Partial<Bubble> = {}): Bubble => ({ from: 'bot', text, ...extra });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [bubbles.length, busy, typing, shownCandidates, stage, error]);

  // Full screen: the page behind does not scroll while the chat is open.
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);

  const focusInput = () => window.requestAnimationFrame(() => inputRef.current?.focus());

  const send = async (req: LabStoryChatRequest): Promise<LabStoryChatResponse | null> => {
    setBusy(true);
    askedAt.current = Date.now();
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

  /**
   * Remi's messages arrive one at a time, each after the dots, as in MySelf:
   * a run of them is several acts, not one dump. The time already spent
   * waiting for the server counts towards the first, so a slow reply is not
   * made slower.
   */
  const deliver = async (items: Bubble[]) => {
    const due = items.filter((b) => b.text);
    for (const [i, item] of due.entries()) {
      setTyping(true);
      const pause = item.story ? handOverPause(item.text) : typingPause(item.text);
      const owed = i === 0 && askedAt.current ? pause - (Date.now() - askedAt.current) : pause;
      if (owed > 0) await wait(owed);
      setBubbles((b) => [...b, item]);
      setTyping(false);
      if (i < due.length - 1) await wait(BETWEEN_MS);
    }
    askedAt.current = 0;
  };

  /** The three versions, handed over one after another with the dots between. */
  const deliverCandidates = async (list: { index: number; text: string }[]) => {
    for (const [i, c] of list.entries()) {
      setTyping(true);
      await wait(handOverPause(c.text));
      setShownCandidates(i + 1);
      setTyping(false);
      if (i < list.length - 1) await wait(BETWEEN_MS);
    }
  };

  const finish = (res: LabStoryChatResponse, fallbackStory: string) => {
    setOpen(false);
    onFinished({ storyId: res.storyId ?? '', receivedAt: res.receivedAt ?? new Date().toISOString(), story: res.story ?? fallbackStory, debriefText: say(screens?.debriefText ?? ''), ending: res.ending ?? '' });
  };

  /** Applies what the server said to the conversation. */
  const apply = async (res: LabStoryChatResponse, req: LabStoryChatRequest) => {
    const s = screens;
    switch (res.stage) {
      case 'interview':
        await deliver([bot(res.reply ?? '')]);
        setStage('interview');
        announce(`${name}: ${res.reply ?? ''}`);
        focusInput();
        break;
      case 'choose':
        await deliver([bot(say(s?.outro ?? '')), bot([say(s?.selectText ?? ''), say(s?.selectLede ?? '')].filter(Boolean).join(' '))]);
        setCandidates(res.candidates ?? []);
        setShownCandidates(0);
        setPicked(null);
        setStage('choose');
        announce(say(s?.selectText ?? 'Choose a story.'));
        await deliverCandidates(res.candidates ?? []);
        break;
      case 'rate':
        setStory(res.story ?? '');
        await deliver([bot(res.story ?? '', { story: true }), bot([say(s?.rateText ?? ''), say(s?.rateLede ?? '')].filter(Boolean).join(' '))]);
        setStage('rate');
        break;
      case 'adapt':
        if (req.action === 'adapt') {
          const changed = !res.failed && !res.limit && res.story && res.story !== story;
          const message = res.failed ? `Sorry, I couldn’t make that change just now. You can edit it yourself, or ask again.` : res.limit ? `That’s as many changes as I can make. You can still edit it yourself.` : res.unchanged || !changed ? `I couldn’t make that change from what you told me, so the story is as it was. You can edit it yourself.` : `Here it is, rewritten. Check it reads right.`;
          await deliver([bot(message), ...(changed ? [bot(res.story!, { story: true })] : [])]);
          if (changed) {
            setHistory((h) => [...h, story]);
            setStory(res.story!);
          }
        } else {
          setStory(res.story ?? story);
          await deliver([bot([say(s?.adaptText ?? ''), say(s?.adaptLede ?? '')].filter(Boolean).join(' '))]);
        }
        setStage('adapt');
        focusInput();
        break;
      case 'stopped':
        await deliver([bot(say(res.text ?? s?.fallbackText ?? ''))]);
        setStage('stopped');
        break;
      case 'done':
        finish(res, story);
        break;
    }
  };

  const run = async (req: LabStoryChatRequest) => {
    const res = await send(req);
    if (res) await apply(res, req);
  };

  const start = async () => {
    if (chatId) {
      setOpen(true);
      focusInput();
      return;
    }
    const res = await send({ action: 'start', participantCode: state.code, phase, source, checkInId: state.flow === 'checkin' ? state.checkIn.checkInId : null, client: labClientInfo() });
    if (!res) return;
    if (!res.available || !res.chatId || !res.screens) {
      onUnavailable();
      return;
    }
    setChatId(res.chatId);
    setScreens(res.screens);
    // The chat opens empty and Remi says hello, then the rest, one message at a time.
    setBubbles([]);
    setStage('interview');
    setOpen(true);
    askedAt.current = 0;
    await deliver([bot(say(res.screens.introAndConsent)), bot(say(res.screens.intro)), bot(res.reply ?? '')]);
    announce(`${res.screens.characterName}: ${res.reply ?? ''}`);
    focusInput();
  };

  /** What the reply box does depends on where the conversation is: an answer, or a change to the story. */
  const submitText = (raw: string) => {
    const text = raw.trim();
    if (!text || !chatId || working) return;
    const voice = pendingNotes.current;
    pendingNotes.current = [];
    setBubbles((b) => [...b, { from: 'me', text, ...(voice.length ? { voice } : {}) }]);
    setDraft('');
    setVoiceTrouble(null);
    if (stage === 'interview') void run({ action: 'reply', chatId, text });
    else if (stage === 'adapt') void run({ action: 'adapt', chatId, request: text, story });
  };
  const voice = useVoice({
    transcribe: async (clip, mimeType, seconds) => {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const res = await getApi().labStoryVoice(session, { chatId: chatId ?? '', audio: await base64Of(clip), mimeType, seconds });
      return res.text;
    },
    onText: (text, note, andSend) => {
      pendingNotes.current = [...pendingNotes.current, note];
      const had = draftRef.current.replace(/\s+$/, '');
      const full = had ? `${had} ${text}` : text;
      setVoiceTrouble(null);
      if (andSend) {
        submitText(full);
        return;
      }
      // The words arrive in the box, to be read and corrected before they are sent.
      setDraft(full);
      setHeard(true);
      window.setTimeout(() => setHeard(false), 1400);
      focusInput();
    },
    onTrouble: (message) => setVoiceTrouble(message),
  });
  const submit = () => {
    if (voice.state === 'recording') {
      voice.finish(true);
      return;
    }
    submitText(draft);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const choose = (index: number) => {
    if (!chatId || working) return;
    const n = candidates.findIndex((c) => c.index === index) + 1;
    setBubbles((b) => [...b, { from: 'me', text: `Version ${n}` }]);
    void run({ action: 'choose', chatId, index });
  };
  const rate = (n: number) => {
    if (!chatId || working) return;
    setBubbles((b) => [...b, { from: 'me', text: String(n) }]);
    void run({ action: 'rate', chatId, rating: n });
  };

  const leaveButton = onLeave ? (
    <Button variant="ghost" onClick={onLeave}>
      {leaveLabel}
    </Button>
  ) : null;

  if (!open) {
    return (
      <LabShell kicker={labMyStory.name} title="A short chat about your break." intro={<p>MyStory is a chat with {name}, an AI chatbot the research team set up for this study. {name} asks you a few questions, one at a time, then writes back what it heard in three different ways. You pick the one that fits best and can change anything that isn’t right. It takes about fifteen minutes.</p>} hideContinue hideBack width="wide" secondaryAction={leaveButton}>
        <Disclosure summary={`About ${name}`}>
          <ul>
            {character.about.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>What you type is sent to an AI service (OpenAI) to write {name}’s replies, without your name or your participant ID. The service is asked not to keep it.</li>
            <li>Please leave out names and anything that could identify someone.</li>
          </ul>
        </Disclosure>
        {error && (
          <Callout tone="warning" role="alert">
            <p>{error.message}</p>
          </Callout>
        )}
        <div className="mpmb-actions">
          <Button variant="primary" arrow loading={working} onClick={() => void start()}>
            {chatId ? 'Carry on the chat' : 'Start the chat'}
          </Button>
          {!chatId && (
            <Button variant="link" onClick={onUnavailable}>
              I’d rather write my story myself
            </Button>
          )}
        </div>
      </LabShell>
    );
  }

  const composer = stage === 'interview' || stage === 'adapt';
  // Straight into the page body, so nothing on the page (an animation, a container) can stop it filling the screen.
  return createPortal(
    <div className="mpmb-app mpmb-chatapp" role="dialog" aria-modal="true" aria-label={`Chat with ${name}`}>
      <header className="mpmb-chatapp__bar">
        <button type="button" className="mpmb-chatapp__icon" aria-label="Close the chat" onClick={() => setOpen(false)}>
          <span aria-hidden="true">←</span>
        </button>
        <span className="mpmb-chat__avatar mpmb-chat__avatar--bar" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <div className="mpmb-chatapp__who">
          <strong>{name}</strong>
          <span>{typing || (busy && (stage === 'interview' || stage === 'adapt')) ? 'typing…' : 'AI chatbot · MyStory'}</span>
        </div>
        <button type="button" className="mpmb-chatapp__help" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
          Help
        </button>
      </header>
      {helpOpen && (
        <div className="mpmb-chatapp__panel">
          <ChatSupport />
          <Button variant="secondary" onClick={() => setHelpOpen(false)}>
            Back to the chat
          </Button>
        </div>
      )}

      <div className="mpmb-chatapp__thread" role="log" aria-live="polite" aria-label={`Your chat with ${name}`}>
        <div className="mpmb-chatapp__column">
          <p className="mpmb-chatapp__day">Nobody reads this chat while you type.</p>
          {bubbles
            .filter((b) => b.text)
            .map((b, i) =>
              b.story ? (
                <div key={i} className="mpmb-chat__row mpmb-chat__row--bot">
                  <blockquote className="mpmb-chat__story mpmb-chat__story--bubble">{b.text}</blockquote>
                </div>
              ) : (
                <div key={i} className={`mpmb-chat__row mpmb-chat__row--${b.from}`}>
                  <div className={`mpmb-chat__bubble mpmb-chat__bubble--${b.from}`}>
                    {b.voice?.map((note) => <VoiceNoteBubble key={note.url} note={note} />)}
                    <p>
                      <span className="mpmb-sr-only">{b.from === 'bot' ? `${name}: ` : 'You: '}</span>
                      {b.text}
                    </p>
                  </div>
                </div>
              ),
            )}

          {stage === 'choose' && (
            <div className="mpmb-chat__choices" role="group" aria-label="The three versions">
              {candidates.slice(0, shownCandidates).map((c, i) => (
                <button key={c.index} type="button" id={`chat-candidate-${c.index}`} className={`mpmb-chat__candidate${picked === c.index ? ' is-selected' : ''}`} aria-pressed={picked === c.index} onClick={() => setPicked(c.index)}>
                  <strong>Version {i + 1}</strong>
                  <span>{c.text}</span>
                </button>
              ))}
            </div>
          )}

          {stage === 'adapt' && (
            <div className="mpmb-chat__edit">
              <label className="mpmb-chat__edit-label" htmlFor="chat-story">
                Your story (you can edit it here)
              </label>
              <textarea id="chat-story" className="mpmb-input mpmb-input--area mpmb-chat__story-edit" rows={6} value={story} onChange={(e) => setStory(e.target.value)} />
              {history.length > 0 && (
                <Button
                  variant="link"
                  onClick={() => {
                    setStory(history[history.length - 1]!);
                    setHistory((h) => h.slice(0, -1));
                    setBubbles((b) => [...b, bot('The previous version is back.')]);
                  }}
                >
                  Put the previous version back
                </Button>
              )}
            </div>
          )}

          {(typing || (busy && (stage === 'interview' || stage === 'adapt'))) && (
            <div className="mpmb-chat__row mpmb-chat__row--bot">
              <p className="mpmb-chat__typing">
                <span className="mpmb-sr-only">{name} is writing…</span>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </p>
            </div>
          )}
          {error && (
            <div className="mpmb-chat__error" role="alert">
              <p>{error.message}</p>
              <Button variant="secondary" onClick={error.retry}>
                Try again
              </Button>
            </div>
          )}
          {stage === 'stopped' && <ChatSupport />}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="mpmb-chatapp__foot">
        <div className="mpmb-chatapp__column">
          {stage === 'choose' && (
            <Button variant="primary" block arrow loading={working} disabled={picked === null} onClick={() => picked !== null && choose(picked)}>
              This one
            </Button>
          )}
          {stage === 'rate' && (
            <div className="mpmb-chat__scale" role="group" aria-label={say(screens?.rateText ?? 'How close is this?')}>
              {Array.from({ length: 11 }, (_, n) => (
                <button key={n} type="button" className="mpmb-chat__scale-option" disabled={working} onClick={() => rate(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}
          {stage === 'adapt' && (
            <Button variant="primary" block arrow loading={working} disabled={!story.trim()} onClick={() => chatId && void run({ action: 'finish', chatId, story: story.trim() })}>
              Keep this story
            </Button>
          )}
          {stage === 'stopped' && (
            <Button variant="primary" block arrow loading={working} onClick={() => chatId && void run({ action: 'finish', chatId, story: '' })}>
              Finish
            </Button>
          )}
          {composer && voiceTrouble && (
            <p className="mpmb-chat__voice-trouble" role="alert">
              {voiceTrouble}
            </p>
          )}
          {composer && (
            <div className="mpmb-chat__composer">
              {voice.state === 'idle' ? (
                <>
                  <label className="mpmb-sr-only" htmlFor={stage === 'adapt' ? 'chat-request' : 'chat-input'}>
                    {stage === 'adapt' ? `Ask ${name} to change it` : `Your reply to ${name}`}
                  </label>
                  <textarea
                    id={stage === 'adapt' ? 'chat-request' : 'chat-input'}
                    ref={inputRef}
                    className={`mpmb-chat__input${heard ? ' is-heard' : ''}`}
                    rows={1}
                    maxLength={screens?.maxChars ?? 2000}
                    value={draft}
                    placeholder={stage === 'adapt' ? `Or ask ${name} to change something…` : voice.supported ? 'Message, or hold the mic to talk' : 'Message'}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    disabled={working}
                  />
                </>
              ) : (
                <div className={`mpmb-chat__recording${voice.cancelling ? ' is-cancelling' : ''}`} role="status">
                  {voice.state === 'recording' ? (
                    <>
                      <button type="button" className="mpmb-chat__rec-cancel" onClick={voice.cancel}>
                        Cancel
                      </button>
                      <span className="mpmb-chat__rec-dot" aria-hidden="true" />
                      <span className="mpmb-chat__rec-time" role="timer" aria-live="off">
                        {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}
                      </span>
                      <span className="mpmb-chat__rec-wave" aria-hidden="true">
                        {Array.from({ length: LIVE_BARS }, (_, i) => {
                          const level = voice.wave[i - (LIVE_BARS - voice.wave.length)] ?? 0;
                          return <i key={i} style={{ height: `${Math.max(8, Math.round(level * 100))}%` }} />;
                        })}
                      </span>
                      <span className="mpmb-chat__rec-hint">{voice.cancelling ? 'Let go to cancel' : voice.locked ? 'Recording' : '‹ Slide to cancel · slide up to lock'}</span>
                    </>
                  ) : (
                    <span className="mpmb-chat__rec-hint">Writing it down…</span>
                  )}
                </div>
              )}
              {(voice.state === 'recording' && voice.locked) || (voice.state === 'idle' && (draft.trim() || !voice.supported)) ? (
                <button type="button" className="mpmb-chat__send" aria-label={voice.state === 'recording' ? 'Stop recording and send it' : stage === 'adapt' ? `Ask ${name}` : 'Send'} disabled={working || (voice.state === 'idle' && !draft.trim())} onClick={submit}>
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                    <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" fill="currentColor" />
                  </svg>
                </button>
              ) : null}
              {voice.supported && (voice.state !== 'idle' || !draft.trim()) && (
                <button
                  type="button"
                  className={`mpmb-chat__mic${voice.state === 'recording' ? ' is-listening' : ''}`}
                  aria-label={voice.state === 'recording' ? 'Stop and write it down' : 'Speak your answer'}
                  disabled={working || voice.state === 'writing'}
                  {...voice.mic}
                >
                  {voice.state === 'recording' && voice.locked ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" fill="currentColor" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>,
    document.body,
  );
}

/** Where to get help: the numbers the protocols point to. */
export function ChatSupport() {
  return (
    <div className="mpmb-chat__support" role="note" aria-label="Where to get help">
      <p>{chatSupport.intro}</p>
      <ul>
        {chatSupport.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** A recording, as messaging apps show one: play, the shape of what was said, and how long. */
function VoiceNoteBubble({ note }: { note: VoiceNote }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  const progress = note.seconds ? Math.min(1, at / note.seconds) : 0;
  return (
    <div className="mpmb-chat__voice">
      <button
        type="button"
        className="mpmb-chat__voice-play"
        aria-label={playing ? 'Pause your recording' : 'Play your recording'}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="mpmb-chat__voice-wave" aria-hidden="true">
        {note.shape.map((h, i) => (
          <i key={i} className={i / note.shape.length < progress ? 'is-played' : ''} style={{ height: `${Math.round(h * 100)}%` }} />
        ))}
      </span>
      <span className="mpmb-chat__voice-time">{mmss(playing || at ? at : note.seconds)}</span>
      <audio ref={audio} src={note.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setAt(0); }} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} />
    </div>
  );
}
