export class AsyncValueCache<T> {
  private readonly values = new Map<string, T>()
  private readonly pending = new Map<string, { generation: number; promise: Promise<T> }>()
  private currentGeneration = 0

  get generation() {
    return this.currentGeneration
  }

  get(key: string) {
    const value = this.values.get(key)
    if (value !== undefined) {
      this.values.delete(key)
      this.values.set(key, value)
    }
    return value
  }

  set(key: string, value: T) {
    this.values.delete(key)
    this.values.set(key, value)
  }

  getOrLoad(key: string, load: () => Promise<T>) {
    const cached = this.get(key)
    if (cached !== undefined) return Promise.resolve(cached)

    const existing = this.pending.get(key)
    if (existing?.generation === this.currentGeneration) return existing.promise

    const generation = this.currentGeneration
    const promise = load().then(value => {
      if (generation === this.currentGeneration) this.set(key, value)
      return value
    }).finally(() => {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key)
    })
    this.pending.set(key, { generation, promise })
    return promise
  }

  invalidate() {
    this.currentGeneration += 1
    this.values.clear()
    this.pending.clear()
    return this.currentGeneration
  }
}
