/**
 * dsh-attention browser plugin: fires system notifications whenever the
 * harness needs your attention or has news for you — an approval (permission
 * escalation), a question (ask_user_question), or a background task finishing
 * — in any session, and jumps to that session when the notification is
 * clicked.
 *
 * Plain-JS bundle in the DSH client-module format (window.__ModuleLoader__).
 * @module dsh-attention/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-attention',
  factory: (require) => {
    'use strict'

    const React = require('react')
    const { useCallback, useState } = React

    // ------------------------------------------------------------------
    // Settings persistence (localStorage; survives restarts)
    // ------------------------------------------------------------------

    const SETTINGS_KEY = 'dsh-attention.settings'
    const DEFAULTS = { enabled: true, suppressFocused: true, notifyCompleted: true }

    function loadSettings() {
      try {
        const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
        return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
      } catch {
        return { ...DEFAULTS }
      }
    }

    function saveSettings(settings) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {
        /* storage unavailable; ignore */
      }
    }

    // ------------------------------------------------------------------
    // Notification helpers
    // ------------------------------------------------------------------

    /** True when the Notification API exists in this browser. */
    function notificationsSupported() {
      return typeof globalThis !== 'undefined' && 'Notification' in globalThis
    }

    function permissionState() {
      return notificationsSupported() ? globalThis.Notification.permission : 'unsupported'
    }

    /** Show one system notification; no-op when unsupported or permission missing. */
    function showNotification({ title, body, tag, onSelect }) {
      if (!notificationsSupported() || globalThis.Notification.permission !== 'granted') return
      const options = { body, tag, requireInteraction: true }
      let notification
      try {
        notification = new globalThis.Notification(title, options)
      } catch (error) {
        // Some engines reject options; retry with the plain form.
        try {
          notification = new globalThis.Notification(title)
        } catch {
          return
        }
      }
      if (!notification) return
      notification.onclick = () => {
        try {
          globalThis.focus()
        } catch { /* ignore */ }
        try {
          onSelect()
        } catch { /* ignore */ }
        try {
          notification.close()
        } catch { /* ignore */ }
      }
    }

    /** Notify that a session is waiting for approval or an answer. */
    function firePendingNotification({ sessionId, kind, displayTitle, onSelect }) {
      const name = displayTitle || sessionId
      const body = kind === 'approval'
        ? `工具请求越权执行，需要你审批 —— ${name}`
        : `Agent 向你提问，需要你回答 —— ${name}`
      showNotification({
        title: 'DeepSeek Harness · 需要确认',
        body,
        tag: `dsh-attention:${sessionId}`,
        onSelect: () => onSelect(sessionId),
      })
    }

    /** Notify that a background session finished running. */
    function fireCompletionNotification({ sessionId, displayTitle, onSelect }) {
      const name = displayTitle || sessionId
      showNotification({
        title: 'DeepSeek Harness · 任务完成',
        body: `后台任务已完成 —— ${name}`,
        tag: `dsh-attention:done:${sessionId}`,
        onSelect: () => onSelect(sessionId),
      })
    }

    // ------------------------------------------------------------------
    // The watcher: sessions.list -> pendingInteraction / completed -> notifications
    // ------------------------------------------------------------------

    /**
     * Diff each session-list snapshot against what we already notified about
     * and fire a system notification for every newly-pending interaction
     * (approval or question) and every newly-completed background session.
     * Suppressed while the page is focused AND the session is the one currently
     * on screen (the built-in inline card / green done marker is already
     * visible there).
     */
    function startWatcher(sessions, getSettings, onSelect) {
      const seen = new Map() // sessionId -> kind ("approval" | "question")
      const completedSeen = new Set() // sessionIds already notified as done

      const refresh = () => {
        let snapshot
        try {
          snapshot = sessions.list.getSnapshot()
        } catch {
          return
        }
        const settings = getSettings()
        const focused = typeof document !== 'undefined' && document.hasFocus()

        // 1) Pending interactions (approval / question)
        const pending = new Map()
        for (const id of snapshot.ids) {
          const entry = snapshot.byId[id]
          if (!entry || entry.pendingInteraction === undefined) continue
          pending.set(id, entry.pendingInteraction)
          if (seen.get(id) === entry.pendingInteraction) continue
          seen.set(id, entry.pendingInteraction)
          if (!settings.enabled) continue
          if (settings.suppressFocused && focused && snapshot.current === id) continue
          firePendingNotification({
            sessionId: id,
            kind: entry.pendingInteraction,
            displayTitle: entry.displayTitle ?? entry.title ?? id,
            onSelect,
          })
        }
        // Drop sessions whose interaction settled.
        for (const id of [...seen.keys()]) {
          if (!pending.has(id)) seen.delete(id)
        }

        // 2) Background completions (the runtime arms `completed` only for
        //    sessions that finished while not selected)
        const completedNow = new Set()
        for (const id of snapshot.ids) {
          const entry = snapshot.byId[id]
          if (!entry || entry.completed !== true) continue
          completedNow.add(id)
          if (completedSeen.has(id)) continue
          completedSeen.add(id)
          if (!settings.enabled || !settings.notifyCompleted) continue
          if (settings.suppressFocused && focused && snapshot.current === id) continue
          fireCompletionNotification({
            sessionId: id,
            displayTitle: entry.displayTitle ?? entry.title ?? id,
            onSelect,
          })
        }
        // Re-arm once the done marker clears (session selected / next run).
        for (const id of [...completedSeen]) {
          if (!completedNow.has(id)) completedSeen.delete(id)
        }
      }

      const unsubscribe = sessions.list.subscribe(refresh)
      // Catch up after a page reload: pending/completed items are re-notified once.
      refresh()
      return unsubscribe
    }

    // ------------------------------------------------------------------
    // Settings section UI (Settings -> 确认提醒)
    // ------------------------------------------------------------------

    const styles = {
      panel: { fontFamily: 'inherit', maxWidth: '860px', display: 'flex', flexDirection: 'column', gap: '12px' },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      label: { fontSize: '13px', color: '#475569' },
      button: {
        padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1',
        background: '#fff', cursor: 'pointer', fontSize: '13px', color: '#0f172a',
      },
      primary: { background: '#2563eb', borderColor: '#2563eb', color: '#fff' },
      status: { fontSize: '13px', color: '#475569', margin: '0' },
      error: { fontSize: '13px', color: '#b91c1c', margin: '0' },
      hint: { fontSize: '12px', color: '#64748b', margin: '0' },
    }

    function AttentionSettingsPanel() {
      const [settings, setSettings] = useState(loadSettings)
      const [permission, setPermission] = useState(permissionState)
      const [message, setMessage] = useState('')

      const toggle = useCallback((key) => {
        setSettings((current) => {
          const next = { ...current, [key]: !current[key] }
          saveSettings(next)
          return next
        })
      }, [])

      const requestPermission = useCallback(async () => {
        if (!notificationsSupported()) {
          setMessage('当前浏览器不支持系统通知（Notification API 不可用）。')
          return
        }
        setMessage('')
        try {
          const result = await globalThis.Notification.requestPermission()
          setPermission(result)
          setMessage(result === 'granted'
            ? '已授权：审批/提问/任务完成都会弹出系统通知。'
            : result === 'denied'
              ? '已被拒绝：浏览器将不再显示该站点的通知。可在浏览器站点设置中重新开启。'
              : '未授权：没有权限时只会保留页面内提醒能力。')
        } catch (error) {
          setMessage(`请求通知权限失败：${String(error && error.message || error)}`)
        }
      }, [])

      const sendTest = useCallback(() => {
        if (!notificationsSupported() || globalThis.Notification.permission !== 'granted') {
          setMessage('尚未获得通知权限，请先点击「授权系统通知」。')
          return
        }
        firePendingNotification({
          sessionId: 'test',
          kind: 'approval',
          displayTitle: '这是一条测试通知',
          onSelect: () => {},
        })
        setMessage('已发送测试通知（若无弹窗请检查系统/浏览器通知设置）。')
      }, [])

      const renderToggle = (key, text) => React.createElement('label', { style: styles.row },
        React.createElement('input', {
          type: 'checkbox',
          checked: Boolean(settings[key]),
          onChange: () => toggle(key),
        }),
        React.createElement('span', { style: styles.label }, text),
      )

      return React.createElement('div', { style: styles.panel },
        React.createElement('p', { style: styles.hint },
          '当 Agent 需要你审批（权限越权）、回答（ask_user_question），或后台任务完成时，即使你没有盯着页面，也会弹出系统通知；点击通知会自动切到对应会话。'),
        renderToggle('enabled', '启用系统通知提醒'),
        renderToggle('notifyCompleted', '后台任务完成时也发送通知'),
        renderToggle('suppressFocused', '页面正聚焦且正在该会话时，不重复提醒（内置卡片/完成标记已可见）'),
        React.createElement('div', { style: styles.row },
          React.createElement('span', { style: styles.status },
            `通知权限：${permission === 'granted' ? '已授权' : permission === 'denied' ? '已拒绝' : permission === 'default' ? '未授权（默认）' : '浏览器不支持'}`),
          permission !== 'granted' && permission !== 'unsupported'
            ? React.createElement('button', { style: Object.assign({}, styles.button, styles.primary), onClick: requestPermission }, '授权系统通知')
            : null,
          React.createElement('button', { style: styles.button, onClick: sendTest }, '发送测试通知'),
        ),
        message ? React.createElement('p', { style: message.includes('失败') || message.includes('拒绝') ? styles.error : styles.status }, message) : null,
      )
    }

    // ------------------------------------------------------------------
    // Client plugin contract
    // ------------------------------------------------------------------

    const inject = ['slots', 'sessions']

    function apply(ctx) {
      const sessions = ctx.sessions ?? (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined)
      let disposers = []
      try {
        if (!sessions || !sessions.list || typeof sessions.list.subscribe !== 'function') {
          ctx.logger?.warn?.('dsh-attention: sessions.list unavailable, notifications disabled')
        } else {
          disposers.push(startWatcher(sessions, loadSettings, (sessionId) => {
            try {
              sessions.select(sessionId)
            } catch { /* ignore */ }
          }))
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'attention',
          order: 90,
          label: () => '确认提醒',
          inject: () => ({}),
        }, AttentionSettingsPanel))
      } catch (error) {
        for (const dispose of disposers.reverse()) {
          try { dispose() } catch { /* ignore */ }
        }
        throw error
      }
      return () => {
        for (const dispose of disposers.reverse()) {
          try { dispose() } catch { /* ignore */ }
        }
      }
    }

    // DSH client-module contract: the factory receives only `require` and its
    // RETURN value is the module exports (see client-modules materialize).
    return { inject, apply }
  },
})
