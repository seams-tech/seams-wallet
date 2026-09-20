export type PresignatureRefillProgressSnapshotV1 =
  | { readonly kind: 'refilling'; readonly revision: number }
  | { readonly kind: 'settled'; readonly revision: number };

type PresignatureRefillProgressWaiterV1 = (snapshot: PresignatureRefillProgressSnapshotV1) => void;

export class PresignatureRefillProgressV1 {
  private state: PresignatureRefillProgressSnapshotV1 = {
    kind: 'refilling',
    revision: 0,
  };
  private readonly waiters = new Map<
    PresignatureRefillProgressWaiterV1,
    'foreground' | 'background'
  >();

  snapshot(): PresignatureRefillProgressSnapshotV1 {
    return this.state;
  }

  hasForegroundWaiters(): boolean {
    for (const priority of this.waiters.values()) {
      if (priority === 'foreground') return true;
    }
    return false;
  }

  publishAvailable(): void {
    if (this.state.kind === 'settled') return;
    this.state = { kind: 'refilling', revision: this.state.revision + 1 };
    this.flushWaiters();
  }

  settle(): void {
    if (this.state.kind === 'settled') return;
    this.state = { kind: 'settled', revision: this.state.revision };
    this.flushWaiters();
  }

  waitForChange(
    observed: PresignatureRefillProgressSnapshotV1,
    priority: 'foreground' | 'background',
  ): Promise<PresignatureRefillProgressSnapshotV1> {
    if (this.state.kind === 'settled' || this.state.revision !== observed.revision) {
      return Promise.resolve(this.state);
    }
    return new Promise((resolve) => {
      this.waiters.set(resolve, priority);
      if (this.state.kind === 'settled' || this.state.revision !== observed.revision) {
        this.waiters.delete(resolve);
        resolve(this.state);
      }
    });
  }

  private flushWaiters(): void {
    const snapshot = this.state;
    const waiters = [...this.waiters.keys()];
    this.waiters.clear();
    for (const waiter of waiters) waiter(snapshot);
  }
}
