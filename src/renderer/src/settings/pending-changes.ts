/** Fields the user edited since the last save; only these are written. */
export function createPendingChanges<T extends object>(): {
  set<K extends keyof T>(key: K, value: T[K]): void
  take(): Partial<T>
} {
  let changes: Partial<T> = {}
  return {
    set: (key, value) => {
      changes[key] = value
    },
    take: () => {
      const out = changes
      changes = {}
      return out
    }
  }
}
