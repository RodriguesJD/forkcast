import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaver, type SaveStatus } from './sync';

describe('createSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(opts: { fail?: (value: number) => Error | undefined } = {}) {
    const saved: number[] = [];
    const statuses: SaveStatus[] = [];
    const save = vi.fn(async (v: number) => {
      const err = opts.fail?.(v);
      if (err) throw err;
      saved.push(v);
    });
    const saver = createSaver(save, {
      debounceMs: 100,
      maxBackoffMs: 5000,
      isFatal: (e) => (e as Error).message === 'fatal',
      onStatus: (s) => statuses.push(s),
    });
    return { saved, statuses, save, saver };
  }

  it('coalesces a burst of edits into one save of the latest value', async () => {
    const h = harness();
    h.saver.set(1);
    h.saver.set(2);
    h.saver.set(3);
    expect(h.saver.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(99);
    expect(h.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.saved).toEqual([3]);
    expect(h.saver.hasPending()).toBe(false);
    expect(h.statuses).toEqual(['saving', 'saving', 'saving', 'saved']);
  });

  it('saves an edit made while a save is in flight, afterwards', async () => {
    let release!: () => void;
    const save = vi.fn((_: number) => new Promise<void>((r) => (release = r)));
    const saved: number[] = [];
    const saver = createSaver(async (v: number) => {
      await save(v);
      saved.push(v);
    }, { debounceMs: 10 });
    saver.set(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);
    saver.set(2);
    expect(saver.hasPending()).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual([1, 2]);
    expect(saver.hasPending()).toBe(false);
  });

  it('retries with exponential backoff and never drops the newest value', async () => {
    let failures = 3;
    const h = harness({ fail: () => (failures-- > 0 ? new Error('network') : undefined) });
    h.saver.set(1);
    await vi.advanceTimersByTimeAsync(100); // attempt 1 fails
    expect(h.statuses.at(-1)).toBe('retrying');
    h.saver.set(2); // edit during backoff; must not reset the backoff
    await vi.advanceTimersByTimeAsync(999);
    expect(h.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // +1000: attempt 2 fails
    expect(h.save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); // +2000: attempt 3 fails
    expect(h.save).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000); // +4000: attempt 4 succeeds
    expect(h.saved).toEqual([2]);
    expect(h.statuses.at(-1)).toBe('saved');
    expect(h.saver.hasPending()).toBe(false);
  });

  it('caps the backoff', async () => {
    let calls = 0;
    const h = harness({ fail: () => (++calls <= 10 ? new Error('network') : undefined) });
    h.saver.set(1);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000); // attempts 2..4
    expect(h.save).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(5000); // capped: attempt 5 after 5 s, not 8 s
    expect(h.save).toHaveBeenCalledTimes(5);
  });

  it('stops on a fatal error, keeps the value pending, and resumes on the next edit', async () => {
    let fatal = true;
    const h = harness({ fail: () => (fatal ? new Error('fatal') : undefined) });
    h.saver.set(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.statuses.at(-1)).toBe('failed');
    expect(h.saver.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.save).toHaveBeenCalledTimes(1);
    fatal = false;
    h.saver.set(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.saved).toEqual([2]);
  });

  it('flush saves immediately and dispose stops everything', async () => {
    const h = harness();
    h.saver.set(1);
    h.saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.saved).toEqual([1]);
    h.saver.set(2);
    h.saver.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.saved).toEqual([1]);
  });
});
