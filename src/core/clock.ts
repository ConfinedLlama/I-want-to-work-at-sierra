/**
 * Time is injected everywhere it matters (rate limits, retries, cache expiry,
 * and later sequence scheduling) so tests can move it by hand instead of sleeping.
 */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

/** A clock that only moves when something sleeps on it. For tests. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  sleep(ms: number): Promise<void> {
    const duration = Math.max(0, ms);
    this.sleeps.push(duration);
    this.current += duration;
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
