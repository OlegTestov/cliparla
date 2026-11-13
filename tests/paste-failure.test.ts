/**
 * A paste that fails after the Accessibility check must not lose the dictated text.
 */

import './helpers/electron-stub'
import './helpers/with-indicator'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  clipboardWrites,
  dialogs,
  mediaAccess,
  notifications,
  resetRecorded,
  sentMessages
} from './helpers/electron-stub'
import { FakeTranslationService } from './helpers/fake-service'

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../src/main/core/window-manager')
const { deliverText, resetPromptForTests } = require('../src/main/services/paste-delivery')
const { pasteText } = require('../src/main/services/keyboard-simulator')
const { setTranslationService } = require('../src/main/services/translation')
const {
  startDictation,
  stopListeningAndProcess,
  handleDictationComplete,
  cancelDictation,
  getDictationState
} = require('../src/main/services/dictation')

const realPlatform = process.platform
const restorePlatform = (): void => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
}

const audio = { audioBase64: 'QVVESU8=', mimeType: 'audio/webm' }

async function dictate(text: string, deps: Record<string, unknown>) {
  const service = new FakeTranslationService()
  service.translateSpeech = (async () => ({ success: true, text })) as never
  setTranslationService(service)
  startDictation()
  stopListeningAndProcess()
  await handleDictationComplete(audio, deps)
}

describe('a failed paste', () => {
  beforeEach(() => {
    resetRecorded()
    cancelDictation()
    resetPromptForTests()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    mediaAccess.accessibility = true
  })
  afterEach(restorePlatform)

  it('copies the text and tells the user', async () => {
    const copied: string[] = []
    let notices = 0
    await deliverText('HELLO', {
      isTrusted: () => true,
      paste: async () => {
        throw new Error('paste helper failed')
      },
      copy: (t: string) => void copied.push(t),
      notify: () => void notices++
    })
    assert.deepEqual(copied, ['HELLO'])
    assert.equal(notices, 1)
  })

  it('copies after the paste attempt has finished', async () => {
    const events: string[] = []
    await deliverText('HELLO', {
      isTrusted: () => true,
      paste: async () => {
        events.push('attempt')
        throw new Error('fail')
      },
      copy: () => void events.push('copy'),
      notify: () => {}
    })
    assert.deepEqual(events, ['attempt', 'copy'])
  })

  it('the dictated text stays available with an asynchronous clipboard', async () => {
    class Item {
      constructor(private readonly data: Record<string, unknown>) {}
      get types() {
        return Object.keys(this.data)
      }
      async getType(type: string) {
        return this.data[type]
      }
    }
    let items = [new Item({ 'text/plain': 'OLD' })]
    const clipboard = {
      read: async () => items,
      // The restore resolves later, as a real clipboard does
      write: async (next: Item[]) => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        items = next
      },
      writeText: (text: string) => void (items = [new Item({ 'text/plain': text })])
    }
    await deliverText('DICTATED', {
      isTrusted: () => true,
      paste: (text: string) =>
        pasteText(text, {
          clipboard,
          Item,
          targetReady: () => true,
          simulate: async () => {
            throw new Error('paste helper failed')
          }
        }),
      copy: (text: string) => clipboard.writeText(text),
      notify: () => {}
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(await items[0].getType('text/plain'), 'DICTATED')
  })

  it('does not ask for the permission again: it is already granted', async () => {
    let prompts = 0
    await deliverText('X', {
      isTrusted: () => true,
      paste: async () => {
        throw new Error('fail')
      },
      copy: () => {},
      notify: () => {},
      prompt: () => void prompts++,
      watchGrant: () => void prompts++
    })
    assert.equal(prompts, 0)
  })

  it('in a dictation: text on the clipboard, state idle, no error box', async () => {
    let notices = 0
    await dictate('DICTATED', {
      paste: async () => {
        throw new Error('fail')
      },
      notify: () => void notices++
    })
    assert.deepEqual(clipboardWrites, ['DICTATED'])
    assert.equal(notices, 1)
    assert.equal(getDictationState(), 'idle')
    assert.deepEqual(dialogs, [])
  })

  it('if even the copy fails, the user sees an error instead of silence', async () => {
    windowManager.registerDefaultWindows()
    windowManager.createAll()
    sentMessages.length = 0
    await dictate('LOST', {
      paste: async () => {
        throw new Error('fail')
      },
      copy: () => {
        throw new Error('clipboard gone')
      },
      notify: () => {}
    })
    assert.equal(dialogs.length, 0)
    assert.equal(
      sentMessages.filter((m) => m.channel === 'listening-mode-error').length,
      1,
      'the error is shown in the indicator'
    )
    assert.equal(getDictationState(), 'idle')
  })
})

describe('the notice after a failed paste', () => {
  beforeEach(() => {
    resetRecorded()
    resetPromptForTests()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })
  afterEach(restorePlatform)

  it('with Accessibility granted does not ask for Accessibility or Automation', async () => {
    await deliverText('X', {
      isTrusted: () => true,
      paste: async () => {
        throw new Error('paste helper failed')
      },
      copy: () => {}
    })
    assert.equal(notifications.length, 1)
    const body = notifications[0].body ?? ''
    assert.match(body, /Text copied/)
    assert.doesNotMatch(body, /System Events|Automation|Allow Accessibility/)
  })

  it('without Accessibility still asks for Accessibility', async () => {
    await deliverText('X', {
      isTrusted: () => false,
      copy: () => {},
      prompt: () => {},
      watchGrant: () => {}
    })
    assert.equal(notifications.length, 1)
    assert.match(notifications[0].body ?? '', /Allow Accessibility/)
    assert.doesNotMatch(notifications[0].body ?? '', /System Events/)
  })
})

describe('on Windows and Linux', () => {
  const { pasteKey } = require('../src/shared/paste-key')
  const original = process.platform
  afterEach(() => Object.defineProperty(process, 'platform', { value: original }))

  for (const platform of ['win32', 'linux']) {
    for (const trusted of [true, false]) {
      it(`${platform}: the notice says Ctrl+V and no macOS permission (${trusted ? 'paste failed' : 'no permission'})`, async () => {
        resetRecorded()
        resetPromptForTests()
        Object.defineProperty(process, 'platform', { value: platform })
        await deliverText('X', {
          isTrusted: () => trusted,
          paste: async () => {
            throw new Error('xdotool missing')
          },
          copy: () => {},
          prompt: () => {},
          watchGrant: () => {}
        })
        const body = notifications[0].body ?? ''
        assert.match(body, /Ctrl\+V/)
        assert.doesNotMatch(body, /Accessibility|System Events|Automation|⌘/)
      })
    }
  }

  it('the indicator gets the same key from the same helper', () => {
    assert.match(pasteKey('win32'), /Ctrl\+V/)
    assert.match(pasteKey('linux'), /Ctrl\+V/)
    assert.match(pasteKey('darwin'), /⌘V/)
  })
})
