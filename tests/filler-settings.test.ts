/** Exercise Settings hooks, change handler, debounce, IPC and reload with fake IO and time. */
import './helpers/electron-stub'
import { it } from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { ipc, trustedEvent } from './helpers/electron-stub'

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const store = require('../src/main/services/store')
const { registerSettingsHandlers } = require('../src/main/ipc/settings')
const realReact = require('react')

it('F4: the dictation toggle saves OFF/ON through Settings and reloads each value', async (t) => {
  registerSettingsHandlers()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const originalWindow = globalThis.window
  const saves: unknown[] = []
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    electronAPI: {
      getSettings: async () => ipc.handlers.get('get-settings')!(trustedEvent),
      saveSettings: async (changes: unknown) => {
        saves.push(changes)
        return ipc.handlers.get('save-settings')!(trustedEvent, changes)
      },
      getAppVersion: async () => 'test',
      onSettingsChangedFromTray: () => () => {},
      onUiLanguageChanged: () => () => {}
    }
  } as any

  // A small hook runner: no browser, Electron, hotkeys or key events.
  let slots: any[] = []
  let cursor = 0
  let effects: Array<() => void> = []
  const hooks = {
    ...realReact,
    useState(initial: any) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [
        slots[i].value,
        (next: any) => {
          slots[i].value = typeof next === 'function' ? next(slots[i].value) : next
        }
      ]
    },
    useRef(initial: any) {
      const i = cursor++
      return (slots[i] ??= { current: initial })
    },
    useCallback(fn: any) {
      return fn
    },
    useEffect(fn: any, deps: any[]) {
      const i = cursor++
      const previous = slots[i]
      if (!previous || deps.some((value, j) => value !== previous.deps[j])) {
        slots[i] = { deps, cleanup: previous?.cleanup }
        effects.push(() => {
          slots[i].cleanup?.()
          slots[i].cleanup = fn()
        })
      }
    }
  }
  const internals = Module as any
  const load = internals._load
  internals._load = function (request: string, parent: any, ...rest: any[]) {
    if (parent?.filename.endsWith('/settings/App.tsx')) {
      if (request === 'react') return hooks
      if (request === 'react-i18next')
        return { useTranslation: () => ({ t: (key: string) => key }) }
      if (request === '../i18n')
        return { __esModule: true, default: { language: 'en', changeLanguage() {} } }
      if (request === '../hooks/useOnlineStatus') return { useOnlineStatus: () => true }
      if (request.startsWith('./components/')) return { __esModule: true, default: request }
    }
    return load.call(this, request, parent, ...rest)
  }
  t.after(() => {
    internals._load = load
    unmount()
    globalThis.window = originalWindow
  })
  const App = require('../src/renderer/src/settings/App').default
  function unmount() {
    for (const slot of slots) slot?.cleanup?.()
    slots = []
  }
  function render(): any[] {
    cursor = 0
    effects = []
    const root = App()
    effects.forEach((fn) => fn())
    const nodes: any[] = []
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node?.props) return
      nodes.push(node)
      visit(node.props.children)
    }
    visit(root)
    return nodes
  }
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
  async function openDictation() {
    render()
    await settle()
    let nodes = render()
    t.mock.timers.tick(101)
    nodes.find((n) => n.props.onSectionChange).props.onSectionChange('voice')
    nodes = render()
    const switches = nodes.filter((n) => n.type === 'input' && n.props.role === 'switch')
    assert.equal(switches.length, 1)
    const toggle = switches[0]
    assert.ok(nodes.some((n) => n.type === 'label' && n.props.htmlFor === toggle.props.id))
    assert.ok(
      nodes.some(
        (n) =>
          n.props.id === toggle.props['aria-describedby'] &&
          n.props.children === 'settings.voice.removeFillerWordsHint'
      )
    )
    return toggle
  }

  let toggle = await openDictation()
  assert.equal(toggle.props.checked, true)
  for (const enabled of [false, true]) {
    toggle.props.onChange({ target: { checked: enabled } })
    render()
    t.mock.timers.tick(500)
    await settle()
    assert.deepEqual(saves.at(-1), { removeFillerWords: enabled })
    assert.equal(store.getAllSettings().removeFillerWords, enabled)
    unmount()
    toggle = await openDictation()
    assert.equal(toggle.props.checked, enabled, 'reopening Settings restores the saved switch')
  }
  assert.equal(saves.length, 2, 'loading settings never saves defaults over the stored value')
})
