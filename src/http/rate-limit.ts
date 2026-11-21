import type { Clock } from "../core/clock.js";

/**
 * Spaces out requests per host. Each host gets a minimum gap between request
 * starts; callers queue behind each other in arrival order.
 *
 * This is deliberately simpler than a token bucket. The public APIs we call
 * publish limits as "N per hour" or "be gentle", and an even spacing is the
 * most polite way to honour both.
 */
export class HostRateLimiter {
  private readonly nextFree = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly clock: Clock,
    private readonly defaultIntervalMs: number,
    private readonly perHostIntervalMs: Readonly<Record<string, number>> = {},
  ) {}

  /** Resolves when the caller may send its request to `host`. */
  acquire(host: string): Promise<void> {
    const previous = this.queues.get(host) ?? Promise.resolve();
    const turn = previous.then(() => this.waitForSlot(host));
    // A failed wait must not wedge everyone queued behind it.
    this.queues.set(
      host,
      turn.catch(() => undefined),
    );
    return turn;
  }

  private async waitForSlot(host: string): Promise<void> {
    const interval = this.perHostIntervalMs[host] ?? this.defaultIntervalMs;
    const wait = (this.nextFree.get(host) ?? 0) - this.clock.now();
    if (wait > 0) await this.clock.sleep(wait);
    this.nextFree.set(host, this.clock.now() + interval);
  }
}
