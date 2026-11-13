/**
 * An AI action started on capture A must not overwrite capture B.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/* eslint-disable @typescript-eslint/no-require-imports */
const { ResultController } = require('../src/renderer/src/result/result-controller')

const MESSAGES = { failed: 'failed', unexpected: 'unexpected' }

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ResultController', () => {
  it('shows the translation, then replaces it with the action result', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    await c.runAction(
      'summarize',
      async (text: string) => ({ success: true, text: `sum(${text})` }),
      MESSAGES
    )
    assert.deepEqual(c.getState().result, { success: true, text: 'sum(A)' })
    assert.equal(c.getState().processingAction, null)
  })

  it('every action works on the translation, which stays one click away', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    const echo = (name: string) => async (text: string) => ({
      success: true,
      text: `${name}(${text})`
    })
    await c.runAction('summarize', echo('sum'), MESSAGES)
    assert.equal(c.getState().view, 'summarize')
    await c.runAction('comment', echo('com'), MESSAGES)
    assert.deepEqual(c.getState().result, { success: true, text: 'com(A)' })
    assert.equal(c.getState().view, 'comment')
    c.showTranslation()
    assert.deepEqual(c.getState().result, { success: true, text: 'A' })
    assert.equal(c.getState().view, null)
  })

  it('after a failed action the translation can be shown again', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    await c.runAction('improve', async () => ({ success: false, error: 'quota' }), MESSAGES)
    assert.equal(c.getState().result.success, false)
    c.showTranslation()
    assert.deepEqual(c.getState().result, { success: true, text: 'A' })
  })

  it('a slow action for capture A does not overwrite capture B', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    const slow = deferred<{ success: boolean; text?: string }>()
    const action = c.runAction('summarize', () => slow.promise, MESSAGES)
    assert.equal(c.getState().processingAction, 'summarize')

    c.start() // capture B begins
    assert.equal(c.getState().processingAction, null)
    c.complete({ success: true, text: 'B' })

    slow.resolve({ success: true, text: 'SUMMARY_OF_A' })
    await action
    assert.deepEqual(c.getState().result, { success: true, text: 'B' })
    assert.equal(c.getState().processingAction, null)
    assert.equal(c.getState().isLoading, false)
  })

  it('a failing action for an old capture is ignored too', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    const slow = deferred<never>()
    const action = c.runAction('improve', () => slow.promise, MESSAGES)
    c.start()
    c.complete({ success: true, text: 'B' })
    slow.reject(new Error('boom'))
    await action
    assert.deepEqual(c.getState().result, { success: true, text: 'B' })
  })

  it('a late action does not clear the spinner of a newer capture', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    const slow = deferred<{ success: boolean; text?: string }>()
    const action = c.runAction('comment', () => slow.promise, MESSAGES)
    c.start() // B still translating
    slow.resolve({ success: true, text: 'late' })
    await action
    assert.equal(c.getState().isLoading, true)
    assert.equal(c.getState().result, null)
  })

  it('reports failures of the current action', async () => {
    const c = new ResultController()
    c.start()
    c.complete({ success: true, text: 'A' })
    await c.runAction('comment', async () => ({ success: false, error: 'quota' }), MESSAGES)
    assert.deepEqual(c.getState().result, { success: false, error: 'quota' })
    c.start()
    c.complete({ success: true, text: 'A' })
    await c.runAction(
      'comment',
      async () => {
        throw new Error('x')
      },
      MESSAGES
    )
    assert.deepEqual(c.getState().result, { success: false, error: 'unexpected' })
  })

  it('notifies subscribers with a new snapshot on each change', () => {
    const c = new ResultController()
    let calls = 0
    const off = c.subscribe(() => calls++)
    const before = c.getState()
    c.start()
    assert.notEqual(c.getState(), before)
    assert.equal(calls, 1)
    off()
    c.complete({ success: true, text: 'x' })
    assert.equal(calls, 1)
  })
})
