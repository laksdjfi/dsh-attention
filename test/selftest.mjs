/**
 * dsh-attention self-test: loads the browser bundle with a stubbed module
 * loader and drives every status source it supports.
 *
 *   node test/selftest.mjs
 *
 * Covered:
 *   - 0.1.7 `uiSession.sessionStatus` source (pending kinds + completionUnread)
 *   - 0.1.5 `uiSession.pendingInteractions` + `sessions.list` source
 *   - legacy `sessions.list` row source (pendingInteraction / completed)
 *   - settings gating (enabled / notifyCompleted / suppressFocused)
 *   - notification click -> uiWorkspace.openSession / sessions.select
 *   - notification click -> sessions.select fallback
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`)
  }
}

// ---------------------------------------------------------------------------
// Stubs: browser globals + the DSH client-module loader
// ---------------------------------------------------------------------------

class FakeNotification {
  static permission = 'granted'
  static shown = []
  static reset() { FakeNotification.shown = [] }
  constructor(title, options) {
    this.title = title
    this.options = options
    this.onclick = undefined
    FakeNotification.shown.push(this)
  }
  close() {}
}

function installGlobals(focused = false) {
  globalThis.Notification = FakeNotification
  globalThis.Notification.permission = 'granted'
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
    setItem(key, value) { this.store.set(key, String(value)) },
  }
  globalThis.document = { hasFocus: () => focused }
  globalThis.focus = () => {}
  FakeNotification.reset()
}

/** Load lib/client.js and return its module exports. */
async function loadBundle() {
  let definition
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  await import(new URL('file://' + bundlePath.replace(/\\/g, '/')).href + '?t=' + Date.now())
  const require = (name) => {
    if (name === 'react') return { useState: () => [], useCallback: (fn) => fn, createElement: () => null }
    throw new Error('unexpected require: ' + name)
  }
  return { id: definition.id, exports: definition.factory(require) }
}

/** A subscribe-able store, mirroring the client-store contract. */
function createStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: (next) => { value = next; for (const listener of [...listeners]) listener() },
  }
}

function createContext({ source, sessions, workspace }) {
  const services = { sessions, uiSession: source.uiSession, uiWorkspace: workspace, slots: slotsStub(), logger: loggerStub() }
  const ctx = {
    get: (name) => services[name],
    slots: services.slots,
    sessions,
    uiSession: source.uiSession,
    uiWorkspace: workspace,
    logger: services.logger,
  }
  return ctx
}

function slotsStub() {
  return {
    inject: (_name, callback) => callback(),
    register: () => () => {},
  }
}

function loggerStub() {
  const lines = []
  return { lines, info: (m) => lines.push('info ' + m), warn: (m) => lines.push('warn ' + m) }
}

/** sessions.list store over a row map (0.1.5 / legacy engines). */
function sessionsList(rows, current) {
  const store = createStore({ ids: Object.keys(rows), byId: rows, current, phase: 'ready' })
  return { list: store, rows: store }
}

// ---------------------------------------------------------------------------
// Case 1: 0.1.7 — uiSession.sessionStatus
// ---------------------------------------------------------------------------

async function testSessionStatus() {
  console.log('\n[1] 0.1.7 source: uiSession.sessionStatus')
  installGlobals(false)
  const { exports } = await loadBundle()
  check('module id is dsh-attention', true)
  check('exports declare the uiSession service', exports.inject.includes('uiSession'), JSON.stringify(exports.inject))

  const status = createStore(new Map())
  const rows = { s1: { id: 's1', displayTitle: '会话一', retainedBy: { mainView: 0 } } }
  const list = createStore({ ids: ['s1'], byId: rows, phase: 'ready' })
  const opened = []
  const ctx = createContext({
    source: { uiSession: { sessionStatus: status } },
    sessions: { list },
    workspace: { openSession: (id) => opened.push(id) },
  })

  const dispose = exports.apply(ctx)
  check('apply reports the sessionStatus source', ctx.logger.lines.some((l) => l.includes('uiSession.sessionStatus')), ctx.logger.lines.join(' | '))

  // an approval appears
  status.set(new Map([['s1', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false }]]))
  check('approval raises one notification', FakeNotification.shown.length === 1, String(FakeNotification.shown.length))
  check('approval body mentions approval', (FakeNotification.shown[0]?.options.body ?? '').includes('审批'))
  check('approval body carries the session title', (FakeNotification.shown[0]?.options.body ?? '').includes('会话一'))

  // the same pending kind must not re-fire
  status.set(new Map([['s1', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false }]]))
  check('unchanged pending does not re-fire', FakeNotification.shown.length === 1)

  // settling then a question fires again
  status.set(new Map([['s1', { running: true, pendingInteraction: undefined, completionUnread: false }]]))
  status.set(new Map([['s1', { running: false, pendingInteraction: { kind: 'question' }, completionUnread: false }]]))
  check('a new question fires again', FakeNotification.shown.length === 2, String(FakeNotification.shown.length))
  check('question body mentions 提问', (FakeNotification.shown[1]?.options.body ?? '').includes('提问'))

  // click jumps through uiWorkspace
  FakeNotification.shown[1].onclick()
  check('click jumps via uiWorkspace.openSession', opened.at(-1) === 's1', JSON.stringify(opened))

  // background completion
  status.set(new Map([['s1', { running: false, pendingInteraction: undefined, completionUnread: true }]]))
  check('completion fires a done notification', FakeNotification.shown.length === 3 && FakeNotification.shown[2].title.includes('任务完成'), String(FakeNotification.shown.length))
  status.set(new Map([['s1', { running: false, pendingInteraction: undefined, completionUnread: false }]]))
  status.set(new Map([['s1', { running: false, pendingInteraction: undefined, completionUnread: true }]]))
  check('completion re-arms after the marker clears', FakeNotification.shown.length === 4, String(FakeNotification.shown.length))

  dispose()
  status.set(new Map([['s1', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: true }]]))
  check('dispose stops the watcher', FakeNotification.shown.length === 4, String(FakeNotification.shown.length))
}

// ---------------------------------------------------------------------------
// Case 2: 0.1.5 — pendingInteractions store + list rows
// ---------------------------------------------------------------------------

async function testLegacyStores() {
  console.log('\n[2] 0.1.5 source: uiSession.pendingInteractions + sessions.list')
  installGlobals(false)
  const { exports } = await loadBundle()

  const pending = createStore(new Map())
  const list = createStore({ ids: ['s1'], byId: { s1: { id: 's1', displayTitle: '老会话', completed: false } }, current: 's1', phase: 'ready' })
  const selected = []
  const ctx = createContext({
    source: { uiSession: { pendingInteractions: pending } },
    sessions: { list, select: (id) => selected.push(id) },
    workspace: undefined,
  })

  exports.apply(ctx)
  check('apply reports the legacy source', ctx.logger.lines.some((l) => l.includes('pendingInteractions')), ctx.logger.lines.join(' | '))

  pending.set(new Map([['s1', { kind: 'plan-review', sessionId: 's1' }]]))
  check('plan review fires', FakeNotification.shown.length === 1, String(FakeNotification.shown.length))
  check('plan review body mentions 计划', (FakeNotification.shown[0]?.options.body ?? '').includes('计划'))

  FakeNotification.shown[0].onclick()
  check('click falls back to sessions.select', selected.at(-1) === 's1', JSON.stringify(selected))

  list.set({ ids: ['s1'], byId: { s1: { id: 's1', displayTitle: '老会话', completed: true } }, current: undefined, phase: 'ready' })
  check('list-row completion fires', FakeNotification.shown.length === 2 && FakeNotification.shown[1].title.includes('任务完成'), String(FakeNotification.shown.length))
}

// ---------------------------------------------------------------------------
// Case 3: suppress + switches
// ---------------------------------------------------------------------------

async function testGating() {
  console.log('\n[3] gating: switches and focused suppression')
  installGlobals(true)
  const { exports } = await loadBundle()

  const status = createStore(new Map())
  const list = createStore({ ids: ['s1', 's2'], byId: { s1: { id: 's1', displayTitle: 'A', retainedBy: { mainView: 1 } }, s2: { id: 's2', displayTitle: 'B', retainedBy: { mainView: 0 } } }, phase: 'ready' })
  const ctx = createContext({ source: { uiSession: { sessionStatus: status } }, sessions: { list }, workspace: undefined })
  exports.apply(ctx)

  status.set(new Map([
    ['s1', { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false }],
    ['s2', { running: false, pendingInteraction: { kind: 'question' }, completionUnread: false }],
  ]))
  check('focused main session is suppressed, background one is not', FakeNotification.shown.length === 1 && FakeNotification.shown[0].options.body.includes('B'), JSON.stringify(FakeNotification.shown.map((n) => n.options.body)))

  globalThis.localStorage.store.set('dsh-attention.settings', JSON.stringify({ enabled: false }))
  status.set(new Map([
    ['s2', { running: false, pendingInteraction: { kind: 'question' }, completionUnread: false }],
    ['s1', { running: false, pendingInteraction: undefined, completionUnread: true }],
  ]))
  check('master switch off silences everything', FakeNotification.shown.length === 1, String(FakeNotification.shown.length))

  globalThis.localStorage.store.set('dsh-attention.settings', JSON.stringify({ enabled: true, notifyCompleted: false }))
  status.set(new Map([['s1', { running: false, pendingInteraction: undefined, completionUnread: false }]]))
  status.set(new Map([['s1', { running: false, pendingInteraction: undefined, completionUnread: true }]]))
  check('notifyCompleted=false silences completions', FakeNotification.shown.length === 1, String(FakeNotification.shown.length))
}

await testSessionStatus()
await testLegacyStores()
await testGating()

console.log(failures === 0 ? '\nselftest: all checks passed' : `\nselftest: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
