/**
 * The session number travels main -> preload -> App wiring -> controller.
 * A wrong number makes main ignore the audio and the dictation hangs in "processing".
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import {
  bindListeningEvents,
  type ListeningEvents,
  type RecorderController
} from '../src/renderer/src/listening/recorder-controller'

type Listener = (event: unknown, ...args: unknown[]) => void

function loadPreload(): { api: ListeningEvents; emit: (channel: string, ...a: unknown[]) => void } {
  const listeners = new Map<string, Listener>()
  let exposed: unknown = null
  const fake = {
    contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => void (exposed = api) },
    ipcRenderer: {
      on: (channel: string, fn: Listener) => void listeners.set(channel, fn),
      removeListener: (channel: string) => void listeners.delete(channel),
      invoke: async () => undefined,
      send: () => undefined
    }
  }
  const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown }
  const original = mod._load
  mod._load = function (request: string, ...rest: unknown[]) {
    return request === 'electron' ? fake : original.call(this, request, ...rest)
  }
  try {
    const path = require.resolve('../src/preload/index.ts')
    delete require.cache[path]
    require(path)
  } finally {
    mod._load = original
  }
  return {
    api: exposed as ListeningEvents,
    emit: (channel, ...a) => listeners.get(channel)?.({}, ...a)
  }
}

describe('preload: listening-mode-start', () => {
  it('passes the session number to the callback unchanged', () => {
    const { api, emit } = loadPreload()
    const seen: number[] = []
    api.onListeningStart((session) => void seen.push(session))
    emit('listening-mode-start', 41)
    emit('listening-mode-start', 42)
    assert.deepEqual(seen, [41, 42])
  })
})

describe('preload: listening-mode-processing', () => {
  it('tells whether the wait is an automatic retry', () => {
    const { api, emit } = loadPreload()
    const seen: boolean[] = []
    api.onListeningProcessing((retrying) => void seen.push(retrying))
    emit('listening-mode-processing')
    emit('listening-mode-processing', true)
    assert.deepEqual(seen, [false, true])
  })
})

describe('preload: listening-mode-text', () => {
  it('delivers the text that has arrived so far to the controller', () => {
    const { api, emit } = loadPreload()
    const seen: string[] = []
    bindListeningEvents(
      api,
      { onProcessingText: (text: string) => void seen.push(text) } as unknown as RecorderController,
      () => undefined
    )
    emit('listening-mode-text', 'Hel')
    emit('listening-mode-text', 'Hello')
    assert.deepEqual(seen, ['Hel', 'Hello'])
  })
})

describe('listening window wiring', () => {
  function fakeController(calls: string[]): RecorderController {
    return {
      onStart: async (session: number) => void calls.push(`start:${session}`),
      onProcessing: () => void calls.push('processing'),
      onCopied: () => void calls.push('copied'),
      onStop: () => void calls.push('stop')
    } as unknown as RecorderController
  }

  it('passes the session number from the preload event to controller.onStart', () => {
    const { api, emit } = loadPreload()
    const calls: string[] = []
    bindListeningEvents(api, fakeController(calls), () => calls.push('stopped-cb'))
    emit('listening-mode-start', 17)
    emit('listening-mode-processing')
    emit('listening-mode-copied')
    emit('listening-mode-stop')
    assert.deepEqual(calls, ['start:17', 'processing', 'copied', 'stop', 'stopped-cb'])
  })

  it('unbinding removes every listener', () => {
    const { api, emit } = loadPreload()
    const calls: string[] = []
    const unbind = bindListeningEvents(api, fakeController(calls), () => undefined)
    unbind()
    emit('listening-mode-start', 1)
    emit('listening-mode-stop')
    assert.deepEqual(calls, [])
  })
})
