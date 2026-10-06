import { describe, expect, it } from 'vitest';
import type { LabLookupResult } from '../api/types';
import { initialLabState, labJourney, labReducer, nextFilesStep, resumeStep } from './reducer';

const found = (pre: [number, number], post: [number, number] = [0, 0]): LabLookupResult => ({
  exists: true,
  consentedAt: '2026-10-06T10:00:00.000Z',
  archives: pre[0] + post[0],
  screenshots: pre[1] + post[1],
  phases: { pre: { archives: pre[0], screenshots: pre[1] }, mid: { archives: 0, screenshots: 0 }, post: { archives: post[0], screenshots: post[1] } },
  checkIns: 0,
  lastCheckInAt: null,
});

describe('the three pages', () => {
  it('each page files its sends under its own phase and has its own steps', () => {
    expect(initialLabState('baseline').phase).toBe('pre');
    expect(initialLabState('checkin').phase).toBe('mid');
    expect(initialLabState('after').phase).toBe('post');
    expect(labJourney(initialLabState('after'))).toEqual(['participant-id', 'reminder', 'screenshots', 'guide', 'clean', 'send', 'done']);
    expect(labJourney(initialLabState('checkin'))).toEqual(['participant-id', 'checkin', 'done']);
    expect(initialLabState('after').returning).toBe(true);
    expect(initialLabState('baseline').returning).toBe(false);
  });

  it('a confirmed code with consent on file skips the information and consent, and carries on at the next thing to do', () => {
    let s = labReducer(initialLabState('baseline'), { type: 'confirm-code', code: 'JA101CD', returning: true, lookup: found([0, 2]) });
    expect(labJourney(s)).not.toContain('consent');
    expect(nextFilesStep(s)).toBe('guide');
    s = labReducer(s, { type: 'confirm-code', code: 'JA101CD', returning: true, lookup: found([1, 2]) });
    expect(nextFilesStep(s)).toBe('done');
    expect(resumeStep(labReducer(initialLabState('after'), { type: 'confirm-code', code: 'JA101CD', returning: true, lookup: found([1, 2]) }))).toBe('reminder');
    expect(nextFilesStep(labReducer(initialLabState('after'), { type: 'confirm-code', code: 'JA101CD', returning: true, lookup: found([1, 2]) }))).toBe('screenshots');
  });

  it('a different code on the same device starts afresh, on the same step', () => {
    let s = labReducer({ ...initialLabState('baseline'), stepId: 'participant-id' }, { type: 'confirm-code', code: 'JA101CD', returning: true, lookup: found([1, 1]) });
    s = labReducer(s, { type: 'code', code: 'ZZ912AB', returning: true });
    s = labReducer(s, { type: 'confirm-code', code: 'ZZ912AB', returning: true, lookup: { ...found([0, 0]), exists: false } });
    expect(s.stepId).toBe('participant-id');
    expect(s.submission.consentOnFile).toBe(false);
    expect(s.progress).toBeNull();
    expect(labJourney(s)).toContain('consent');
  });

  it('a link with the code keeps the same person where they are, and asks anyone else to confirm', () => {
    const me = { ...labReducer(initialLabState('baseline'), { type: 'confirm-code', code: 'JA101CD', returning: true, lookup: found([1, 1]) }), stepId: 'done' as const };
    expect(labReducer(me, { type: 'use-code', code: 'JA101CD' }).stepId).toBe('done');
    const other = labReducer(me, { type: 'use-code', code: 'ZZ912AB' });
    expect(other.stepId).toBe('participant-id');
    expect(other.code).toBe('ZZ912AB');
    expect(other.codeConfirmed).toBe(false);
  });

  it('sends keep the server counts current for the page’s phase', () => {
    let s = labReducer(initialLabState('after'), { type: 'confirm-code', code: 'JA101CD', returning: true, lookup: found([1, 2]) });
    s = labReducer(s, { type: 'add-screenshot', screenshot: { id: 's1', name: 'a.png', type: 'image/png', size: 10, width: 1, height: 1, status: 'uploaded', progress: 1, uploadId: 'u1', error: null } });
    s = labReducer(s, { type: 'files-sent', ids: ['u1'], receivedAt: '2026-11-06T10:00:00.000Z', donationId: 'd1' });
    expect(s.progress?.phases.post).toEqual({ archives: 0, screenshots: 1 });
    expect(s.progress?.phases.pre).toEqual({ archives: 1, screenshots: 2 });
    expect(nextFilesStep(s)).toBe('guide');
  });
});
