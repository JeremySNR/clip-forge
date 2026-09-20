/** Check on launch, every six hours, and retry failed checks after reconnect. */
export function startUpdateChecks(check: () => Promise<boolean>, events: EventTarget): () => void {
  let stopped = false
  let running = false
  let lastAttempt = -Infinity
  let nextAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async (): Promise<void> => {
    if (stopped || running) return
    running = true
    lastAttempt = Date.now()
    let ok = false
    try { ok = await check() } catch { /* retry below */ }
    finally {
      running = false
      nextAt = Date.now() + (ok ? 6 * 60 * 60_000 : 15 * 60_000)
      if (!stopped) {
        clearTimeout(timer)
        timer = setTimeout(() => void run(), nextAt - Date.now())
      }
    }
  }
  const focus = (): void => { if (Date.now() >= nextAt) void run() }
  const online = (): void => { if (Date.now() - lastAttempt >= 60_000) void run() }
  events.addEventListener('focus', focus)
  events.addEventListener('online', online)
  void run()
  return () => {
    stopped = true
    clearTimeout(timer)
    events.removeEventListener('focus', focus)
    events.removeEventListener('online', online)
  }
}
