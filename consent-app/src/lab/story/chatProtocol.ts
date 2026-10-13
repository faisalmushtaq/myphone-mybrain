import { parse } from 'smol-toml';
import mid from '../mystory/mid.toml?raw';
import post from '../mystory/post.toml?raw';
import pre from '../mystory/pre.toml?raw';
import type { StoryPhase } from '../mystory';

/**
 * What the page needs from each phase's chat protocol before the chat starts
 * (src/lab/mystory/<phase>.toml): the character's name and what it says about
 * itself. Everything else, the prompts included, stays on the server
 * (firebase/functions/src/storyChat.ts), which reads the same files.
 */
const files: Record<StoryPhase, string> = { pre, mid, post };

export interface ChatCharacter {
  name: string;
  about: string[];
}

export function chatCharacter(phase: StoryPhase): ChatCharacter {
  try {
    const t = parse(files[phase]) as { myself?: { character?: { name?: unknown; about?: unknown } } };
    const c = t.myself?.character;
    return {
      name: typeof c?.name === 'string' && c.name.trim() ? c.name.trim() : 'Sam',
      about: Array.isArray(c?.about) ? c.about.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { name: 'Sam', about: [] };
  }
}

/**
 * Fills in {first_name} on screen, on the participant's own device, as MySelf
 * does: the name is never sent to the server or the model. Without a name the
 * placeholder is left out ("Hi {first_name}, I'm Remi" reads "Hi, I'm Remi").
 */
export function withFirstName(text: string, firstName: string): string {
  const name = firstName.trim();
  if (name) return text.replace(/\{first_name\}/g, name);
  return text.replace(/,\s*\{first_name\}/g, '').replace(/\s*\{first_name\}/g, '');
}

/**
 * Where to get help, as the protocols word it (their safeguarding text points
 * participants to "the numbers on the last page"): shown at the end of the
 * chat, and whenever it stops early.
 */
export const chatSupport = {
  intro: 'If you need to talk to someone about how you are feeling, please reach out to one of these, or to someone you trust, like a friend or a family member.',
  lines: [
    'In an emergency, or if you don’t feel safe: call 999 or go to A&E.',
    'To talk to someone now: Leeds Crisis Assessment Centre 0800 183 1485, Samaritans 116 123, or text SHOUT to 85258 (all 24 hours).',
    'For support that isn’t urgent: the University Student Counselling and Wellbeing Service, 0113 343 4107 or scw@leeds.ac.uk.',
  ],
};
