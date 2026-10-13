import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Speaking an answer instead of typing it, ported from MySelf's MyStory
 * (apps/mystory-lab/web/main.ts, wireMic). A participant who finds writing
 * hard should not be shut out of a method whose whole subject is what they
 * have to say.
 *
 *   Hold the microphone to talk, as in WhatsApp: slide left to cancel, slide
 *   up to lock it on; let go and it is written down.
 *   A quick tap starts a locked recording instead, for anybody the gesture
 *   does not suit (a tremor, a laptop, a switch); tap again to stop.
 *   The send button while recording stops, writes it down and sends it.
 *
 * The clip goes to the study's own server (storyChat.ts → labStoryVoice),
 * which keeps it and has OpenAI write it down: never the browser's own
 * recogniser, which would send the voice to Apple or Google. The words come
 * back into the reply box to be read and corrected before they are sent.
 *
 * Two lessons carried over as they were learned there: the container is
 * chosen by trying to build the recorder, because Safari says yes to WebM and
 * then refuses it; and the recorder is started without a timeslice, because
 * asking iOS for chunks gives fragmented MP4 that will not decode.
 */

/** A hard ceiling on one clip, matching the server's: one tap and a pocket should cost one upload. */
export const MAX_CLIP_MS = 120_000;
const CLIP_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus', ''];
const SLIDE_TO_CANCEL = 70;
const SLIDE_TO_LOCK = 55;
const TAP_MS = 350;
export const LIVE_BARS = 40;

export interface VoiceNote {
  url: string;
  seconds: number;
  /** Bar heights, 0 to 1, from what the meter heard while recording. */
  shape: number[];
}

function makeRecorder(stream: MediaStream): MediaRecorder | null {
  for (const type of CLIP_TYPES) {
    try {
      if (type && MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(type)) continue;
      return type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    } catch {
      // Claimed to support it and could not. Try the next.
    }
  }
  return null;
}

export async function base64Of(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The recording's own shape, from the levels the meter collected: a fixed number of bars. */
function shapeOf(levels: number[], bars = 28): number[] {
  if (!levels.length) return Array(bars).fill(0.15);
  return Array.from({ length: bars }, (_, i) => {
    const from = Math.floor((i * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / bars));
    const slice = levels.slice(from, to);
    return Math.max(0.12, Math.min(1, slice.reduce((a, b) => a + b, 0) / slice.length));
  });
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function useVoice({ transcribe, onText, onTrouble }: { transcribe: (clip: Blob, mimeType: string, seconds: number) => Promise<string>; onText: (text: string, note: VoiceNote, send: boolean) => void; onTrouble: (message: string) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'writing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [wave, setWave] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const levels = useRef<number[]>([]);
  const startedAt = useRef(0);
  const discarding = useRef(false);
  const sendWhenWritten = useRef(false);
  const timers = useRef<{ cap?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval>; stopMeter?: () => void }>({});
  const press = useRef<{ id: number | null; at: number; x: number; y: number }>({ id: null, at: 0, x: 0, y: 0 });
  const handlers = useRef({ transcribe, onText, onTrouble });
  handlers.current = { transcribe, onText, onTrouble };

  const release = useCallback(() => {
    clearTimeout(timers.current.cap);
    clearInterval(timers.current.tick);
    timers.current.stopMeter?.();
    timers.current = {};
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    setLocked(false);
    setCancelling(false);
    setState('idle');
  }, []);

  useEffect(() => () => {
    discarding.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
  }, [release]);

  /** Stop and write it down. */
  const finish = useCallback(
    (andSend = false) => {
      discarding.current = false;
      sendWhenWritten.current = andSend;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      else release();
    },
    [release],
  );
  /** Stop and throw it away: cancelling is a decision, not a fault, and gets no message. */
  const cancel = useCallback(() => {
    discarding.current = true;
    sendWhenWritten.current = false;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else release();
  }, [release]);

  const deliver = async (clip: Blob, mimeType: string) => {
    const autoSend = sendWhenWritten.current;
    sendWhenWritten.current = false;
    const secs = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    if (clip.size === 0) {
      release();
      handlers.current.onTrouble('I didn’t catch any sound there. Have another go, or type your answer instead.');
      return;
    }
    const note: VoiceNote = { url: URL.createObjectURL(clip), seconds: secs, shape: shapeOf(levels.current) };
    clearInterval(timers.current.tick);
    timers.current.stopMeter?.();
    setState('writing');
    try {
      const text = await handlers.current.transcribe(clip, clip.type || mimeType, secs);
      if (!text) handlers.current.onTrouble('Nothing came through on that one. Have another go, or type your answer.');
      else handlers.current.onText(text, note, autoSend);
    } catch (error) {
      handlers.current.onTrouble(error instanceof Error && error.message ? error.message : 'That could not be sent just now. Have another go, or type your answer instead.');
    } finally {
      release();
    }
  };

  /** Start listening. Shared by the hold, the tap and the keyboard. */
  const begin = async (): Promise<boolean> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const denied = (error as { name?: string }).name === 'NotAllowedError';
      handlers.current.onTrouble(denied ? 'Your phone did not allow the microphone. You can turn it on in Settings, or type your answer instead.' : 'The microphone would not turn on. You can type your answer instead.');
      return false;
    }
    const rec = makeRecorder(stream);
    if (!rec) {
      stream.getTracks().forEach((t) => t.stop());
      handlers.current.onTrouble('This browser will not record audio. You can type your answer instead.');
      return false;
    }
    const recordedAs = rec.mimeType || '';
    levels.current = [];
    // The meter, off the same stream: bars that move when you speak say the phone is hearing you.
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Context();
      void context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      let raf = 0;
      let last = 0;
      const read = (now: number) => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) {
          const d = (v - 128) / 128;
          sum += d * d;
        }
        levels.current.push(Math.min(1, Math.sqrt(sum / buffer.length) * 3.2));
        if (now - last > 80) {
          last = now;
          setWave(levels.current.slice(-LIVE_BARS));
        }
        raf = requestAnimationFrame(read);
      };
      raf = requestAnimationFrame(read);
      let closed = false;
      timers.current.stopMeter = () => {
        cancelAnimationFrame(raf);
        // Stopped once when the words are on their way and again when the recorder is released: close it only once.
        if (closed) return;
        closed = true;
        void context.close().catch(() => undefined);
      };
    } catch {
      // No meter: the recording still works.
    }
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    rec.onerror = () => {
      handlers.current.onTrouble('The recording stopped unexpectedly. You can try again, or type your answer instead.');
      release();
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (discarding.current) {
        release();
        return;
      }
      void deliver(recordedAs ? new Blob(parts, { type: recordedAs }) : new Blob(parts), recordedAs);
    };
    try {
      // No timeslice: on iOS, chunks make fragmented MP4 that will not decode. One blob at the end is one valid file.
      rec.start();
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      handlers.current.onTrouble(`The recording would not start (${String((error as Error).message ?? error)}).`);
      return false;
    }
    recorder.current = rec;
    startedAt.current = Date.now();
    setSeconds(0);
    setWave([]);
    setState('recording');
    timers.current.cap = setTimeout(() => finish(false), MAX_CLIP_MS);
    timers.current.tick = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return true;
  };

  /* ── The microphone button: hold to talk, slide to cancel or lock, or tap ── */
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (recorder.current) {
      finish(false);
      return;
    }
    if (state !== 'idle') return;
    press.current = { id: event.pointerId, at: Date.now(), x: event.clientX, y: event.clientY };
    setLocked(false);
    setCancelling(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void (async () => {
      const started = await begin();
      if (!started) {
        press.current.id = null;
        return;
      }
      // Let go before the microphone opened: a tap, so it stays on.
      if (press.current.id === null) setLocked(true);
    })();
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (press.current.id !== event.pointerId || locked || !recorder.current) return;
    const left = press.current.x - event.clientX;
    const up = press.current.y - event.clientY;
    if (up > SLIDE_TO_LOCK && up > left) {
      setLocked(true);
      press.current.id = null;
      return;
    }
    setCancelling(left > SLIDE_TO_CANCEL);
  };
  const letGo = (event: PointerEvent<HTMLButtonElement>) => {
    if (press.current.id !== event.pointerId) return;
    press.current.id = null;
    if (locked || !recorder.current) return;
    if (Date.now() - press.current.at < TAP_MS && !cancelling) {
      setLocked(true);
      return;
    }
    if (cancelling) {
      cancel();
      return;
    }
    finish(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (recorder.current) {
      finish(false);
      return;
    }
    void (async () => {
      if (await begin()) setLocked(true);
    })();
  };

  return {
    supported: voiceSupported(),
    state,
    seconds,
    wave,
    locked,
    cancelling,
    finish,
    cancel,
    mic: { onPointerDown, onPointerMove, onPointerUp: letGo, onPointerCancel: letGo, onKeyDown, onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault() },
  };
}
