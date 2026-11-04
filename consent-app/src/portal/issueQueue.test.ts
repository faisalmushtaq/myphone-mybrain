import { describe, expect, it } from 'vitest';
import { IssueQueue, memoryStore, newIssueId } from './issueQueue';

/** A server that stores by id, as portalIssues/{id} does: a second send of one id is a duplicate, not a new entry. */
function server() {
  const stored = new Map<string, unknown>();
  let up = false;
  return {
    stored,
    setUp: (v: boolean) => (up = v),
    send: async (e: { id: string }) => {
      if (!up) return { result: 'offline' as const };
      if (!stored.has(e.id)) stored.set(e.id, e);
      return { result: 'sent' as const };
    },
  };
}

describe('the offline queue', () => {
  it('keeps entries while offline, with their own time, and sends each once when back', async () => {
    const q = new IssueQueue(memoryStore());
    const s = server();
    const counts: number[] = [];
    q.onChange((n) => counts.push(n));
    await q.add({ id: 'b', deviceAt: '2026-11-12T10:45:00Z', note: 'second' });
    await q.add({ id: 'a', deviceAt: '2026-11-12T10:42:00Z', note: 'first' });
    expect(await q.count()).toBe(2);
    expect((await q.flush(s.send)).sent).toBe(0);
    expect(await q.count()).toBe(2);
    s.setUp(true);
    expect((await q.flush(s.send)).sent).toBe(2);
    expect(await q.count()).toBe(0);
    expect([...s.stored.keys()]).toEqual(['a', 'b']);
    expect((s.stored.get('a') as { deviceAt: string }).deviceAt).toBe('2026-11-12T10:42:00Z');
    expect(counts.at(-1)).toBe(0);
  });

  it('a retry after a lost reply is one entry on the server', async () => {
    const q = new IssueQueue(memoryStore());
    const s = server();
    s.setUp(true);
    const e = { id: newIssueId(), deviceAt: '2026-11-12T10:42:00Z' };
    // The first send reached the server but the reply was lost: the entry stayed queued.
    await s.send(e);
    await q.add(e);
    await q.flush(s.send);
    expect(s.stored.size).toBe(1);
    expect(await q.count()).toBe(0);
  });

  it('two flushes at once send once; a refused entry is dropped and reported', async () => {
    const q = new IssueQueue(memoryStore());
    let calls = 0;
    await q.add({ id: 'x', deviceAt: '2026-11-12T10:00:00Z' });
    await q.add({ id: 'y', deviceAt: '2026-11-12T11:00:00Z' });
    const send = async (e: { id: string }) => {
      calls += 1;
      return e.id === 'y' ? { result: 'refused' as const, message: 'The time is in the future: check it.' } : { result: 'sent' as const };
    };
    const [r1, r2] = await Promise.all([q.flush(send), q.flush(send)]);
    expect(calls).toBe(2);
    expect(r1).toBe(r2);
    expect(r1.refused[0].message).toMatch(/future/);
    expect(await q.count()).toBe(0);
  });
});
