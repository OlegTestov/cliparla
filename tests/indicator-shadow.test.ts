/**
 * The indicator window is transparent and the panel sits 4 px inside it (outer p-1).
 * An outer shadow that reaches past those 4 px is cut by the window edge and shows as a
 * translucent rectangle around the panel.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MARGIN = 4
const PANELS = ['src/renderer/src/listening/App.tsx', 'src/renderer/src/listening/ErrorCard.tsx']

describe('indicator panel shadow', () => {
  for (const file of PANELS) {
    const source = readFileSync(file, 'utf8')

    it(`${file}: the outer shadow stays inside the window margin`, () => {
      const shadow = /boxShadow:\s*'(-?\d+)(?:px)? (-?\d+)(?:px)? (\d+)(?:px)?/.exec(source)
      assert.ok(shadow, 'outer boxShadow not found')
      const [x, y, blur] = shadow.slice(1).map(Number)
      assert.ok(Math.abs(x) + blur <= MARGIN, `sideways reach ${Math.abs(x) + blur} px`)
      assert.ok(Math.abs(y) + blur <= MARGIN, `vertical reach ${Math.abs(y) + blur} px`)
    })

    it(`${file}: the panel sits on the 4 px margin`, () => {
      assert.match(source, /className="[^"]*\bp-1\b/)
    })

    it(`${file}: no backdrop blur, it cannot reach other apps' windows`, () => {
      assert.doesNotMatch(source, /backdropFilter/i)
    })
  }
})
