/**
 * The setup page's decisions: where a saved key leads, and that an old
 * "Key saved" banner never comes back.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  savedSubtitleKey,
  screenAfterKeySaved,
  screenOnRequest
} from '../src/renderer/src/setup/flow'

const api = (screenRecording: string, tryItPending: boolean, microphone = 'granted') => ({
  getPermissionsStatus: async () => ({ screenRecording, microphone, accessibility: true }),
  getTryItPending: async () => tryItPending
})

describe('screen after a key was saved', () => {
  it('first run, Screen Recording on: straight to Try it now with the banner', async () => {
    assert.deepEqual(await screenAfterKeySaved(api('granted', true)), {
      step: 'try',
      justSaved: true,
      screenReady: true,
      offerOptional: false
    })
  })

  it('first run, Screen Recording on but Microphone missing: Continue, to be offered it', async () => {
    assert.deepEqual(await screenAfterKeySaved(api('granted', true, 'not-determined')), {
      step: 'saved',
      justSaved: false,
      screenReady: true,
      offerOptional: true
    })
  })

  it('returning user, Screen Recording on: Continue, and the text knows it is on', async () => {
    assert.deepEqual(await screenAfterKeySaved(api('granted', false)), {
      step: 'saved',
      justSaved: false,
      screenReady: true,
      offerOptional: false
    })
  })

  it('first run, Screen Recording missing: Continue, permission still needed', async () => {
    assert.deepEqual(await screenAfterKeySaved(api('denied', true)), {
      step: 'saved',
      justSaved: false,
      screenReady: false,
      offerOptional: false
    })
  })

  it('a failing lookup leaves the choice to main', async () => {
    const broken = {
      getPermissionsStatus: async () => Promise.reject(new Error('x')),
      getTryItPending: async () => Promise.reject(new Error('x'))
    }
    assert.equal((await screenAfterKeySaved(broken)).step, 'saved')
  })
})

describe('subtitle of the Key saved screen', () => {
  it('first run with Screen Recording on and Microphone missing no longer says "try right away"', () => {
    assert.equal(
      savedSubtitleKey({ screenReady: true, offerOptional: true }),
      'setup.saved.subtitleOptional'
    )
  })

  it('otherwise it follows Screen Recording', () => {
    assert.equal(
      savedSubtitleKey({ screenReady: true, offerOptional: false }),
      'setup.saved.subtitleReady'
    )
    assert.equal(
      savedSubtitleKey({ screenReady: false, offerOptional: false }),
      'setup.saved.subtitle'
    )
  })

  it('does not name one permission: it is shown when either Microphone or Accessibility is missing', () => {
    const en = JSON.parse(
      readFileSync(`${__dirname}/../src/renderer/src/i18n/locales/en.json`, 'utf8')
    )
    assert.doesNotMatch(
      en['setup.saved.subtitleOptional'],
      /microphone|paste|pasting|accessibility/i
    )
  })

  it('the page uses it', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/setup/App.tsx`, 'utf8')
    assert.match(page, /savedSubtitleKey\(\{ screenReady, offerOptional \}\)/)
  })
})

describe('the saved-step button', () => {
  it('is disabled after the first click, so setup-done is sent once', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/setup/App.tsx`, 'utf8')
    const button =
      /<button[^>]*?onClick=\{\(\) => \{\s*setFinishing\(true\)\s*window\.electronAPI\.setupDone\(\)[\s\S]*?<\/button>/.exec(
        page
      )
    assert.ok(button, 'the click handler sets finishing before sending setup-done')
    assert.match(page, /disabled=\{finishing\}/)
  })
})

describe('screen requested by main', () => {
  it('never carries the Key saved banner', () => {
    assert.deepEqual(screenOnRequest('TRY_IT'), { step: 'try', justSaved: false })
    assert.deepEqual(screenOnRequest('INVALID_KEY'), { step: 'key', justSaved: false })
    assert.deepEqual(screenOnRequest(undefined), { step: 'key', justSaved: false })
  })
})
