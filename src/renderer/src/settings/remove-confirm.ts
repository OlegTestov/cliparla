/**
 * Removing the API key asks first: the first click only opens the question,
 * the key goes away on the second, explicit one.
 */

export interface RemoveConfirm {
  asking: () => boolean
  /** First click on "Remove key". Never removes. */
  ask: () => void
  /** "Yes, remove". Removes only when the question is open. */
  confirm: () => Promise<void>
  cancel: () => void
}

export function createRemoveConfirm(
  remove: () => Promise<void>,
  onChange: (asking: boolean) => void = () => undefined
): RemoveConfirm {
  let asking = false
  const set = (value: boolean): void => {
    asking = value
    onChange(value)
  }
  return {
    asking: () => asking,
    ask: () => set(true),
    confirm: async () => {
      if (!asking) return
      set(false)
      await remove()
    },
    cancel: () => set(false)
  }
}
