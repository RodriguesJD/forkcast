/**
 * A write-behind queue for one piece of state (the plan, the checkbox map).
 *
 * `set(value)` records the latest value and schedules a save after a short
 * debounce, so a burst of edits becomes one request. A save that fails with a
 * retryable error is retried with exponential backoff, always sending the
 * newest value; an edit that arrives mid-flight is saved right after. Nothing is
 * ever dropped unless the error is fatal (a 4xx: our bug, or the session is
 * gone), in which case the queue stops and reports `failed` so the UI can act.
 *
 * Framework-free so it can be unit-tested with fake timers.
 */

export type SaveStatus = 'saved' | 'saving' | 'retrying' | 'failed';

export interface SaverOptions {
  debounceMs?: number;
  maxBackoffMs?: number;
  /** Errors for which retrying is pointless. Default: never. */
  isFatal?: (err: unknown) => boolean;
  onStatus?: (status: SaveStatus, detail: { attempt: number; error?: unknown }) => void;
}

export interface Saver<T> {
  set(value: T): void;
  /** Skip the debounce and save now (if anything is pending). */
  flush(): void;
  /** True while an edit has not been confirmed by the server. */
  hasPending(): boolean;
  dispose(): void;
}

export function createSaver<T>(save: (value: T) => Promise<void>, options: SaverOptions = {}): Saver<T> {
  const debounceMs = options.debounceMs ?? 400;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const isFatal = options.isFatal ?? (() => false);
  const onStatus = options.onStatus ?? (() => {});

  let latest: T | undefined;
  let dirty = false;
  let inFlight = false;
  let attempt = 0;
  let failed = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(ms: number): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, ms);
  }

  async function run(): Promise<void> {
    if (disposed || inFlight || !dirty) return;
    inFlight = true;
    dirty = false;
    const value = latest as T;
    try {
      await save(value);
      inFlight = false;
      attempt = 0;
      if (disposed) return;
      if (dirty) schedule(0);
      else onStatus('saved', { attempt: 0 });
    } catch (error) {
      inFlight = false;
      dirty = true;
      if (disposed) return;
      if (isFatal(error)) {
        failed = true;
        onStatus('failed', { attempt, error });
        return;
      }
      attempt += 1;
      onStatus('retrying', { attempt, error });
      schedule(Math.min(1000 * 2 ** (attempt - 1), maxBackoffMs));
    }
  }

  return {
    set(value) {
      if (disposed) return;
      latest = value;
      dirty = true;
      // A new edit after a fatal failure is a fresh attempt (the user may have
      // signed back in); during backoff, wait for the backoff timer rather than
      // hammering a server that just failed.
      if (failed) {
        failed = false;
        attempt = 0;
      }
      if (attempt === 0) {
        onStatus('saving', { attempt: 0 });
        schedule(debounceMs);
      }
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      void run();
    },
    hasPending: () => dirty || inFlight,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
