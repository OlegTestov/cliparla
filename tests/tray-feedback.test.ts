/** The tray menu has "Send feedback": the only feedback channel, since the app has no analytics. */

import './helpers/electron-stub'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { openedExternal, resetRecorded, trayMenu } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports */
const { createTray } = require('../src/main/services/tray')
const { FEEDBACK_URL } = require('../src/shared/app-info')
const store = require('../src/main/services/store')

type Item = { label?: string; click?: () => void }
const find = (label: string): Item | undefined =>
  (trayMenu.items as Item[]).find((i) => i.label === label)

describe('tray: Send feedback', () => {
  beforeEach(() => {
    resetRecorded()
    store.saveSettings({ uiLanguage: 'en' })
    createTray()
  })

  it('points at the GitHub issue chooser', () => {
    assert.equal(FEEDBACK_URL, 'https://github.com/OlegTestov/cliparla/issues/new/choose')
  })

  it('a click opens that URL once in the browser', () => {
    const item = find('Send feedback')
    assert.ok(item, 'menu item missing')
    item!.click!()
    assert.deepEqual(openedExternal, [FEEDBACK_URL])
  })

  it('is listed before Quit', () => {
    const labels = (trayMenu.items as Item[]).map((i) => i.label)
    assert.ok(labels.indexOf('Send feedback') > -1)
    assert.ok(labels.indexOf('Send feedback') < labels.indexOf('Quit'))
  })

  it('is translated: Spanish menu shows the Spanish label, not the English one', () => {
    store.saveSettings({ uiLanguage: 'es' })
    createTray()
    assert.equal(find('Send feedback'), undefined)
    assert.ok(find('Enviar comentarios'))
  })
})
