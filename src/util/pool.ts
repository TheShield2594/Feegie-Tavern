/** Minimal object pool used for particles and transient UI nodes. */
export class Pool<T> {
  private free: T[] = [];
  private live = new Set<T>();

  constructor(
    private factory: () => T,
    private reset: (item: T) => void,
    prefill = 0,
  ) {
    for (let i = 0; i < prefill; i++) this.free.push(factory());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.factory();
    this.live.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.live.delete(item)) return;
    this.reset(item);
    this.free.push(item);
  }

  releaseAll(): void {
    for (const item of this.live) {
      this.reset(item);
      this.free.push(item);
    }
    this.live.clear();
  }

  get activeCount(): number {
    return this.live.size;
  }

  forEachActive(fn: (item: T) => void): void {
    this.live.forEach(fn);
  }
}
