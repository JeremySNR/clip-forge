import { BrowserWindow, session, type Session } from 'electron'
import { refreshUrl, webOrigin, WorkvivoWebError } from '@shared/workvivoWeb'

/**
 * Browser session for WorkVivo's internal web API.
 *
 * The documented Customer API authenticates with an org-level token, but the
 * web upload flow (see `@shared/workvivoWeb`) is authenticated as a person:
 * a Laravel session cookie plus two CSRF headers. The only sane way to obtain
 * that in a desktop app is to let the user sign in through a real browser
 * window, SSO and all, and keep the cookie jar.
 *
 * Cookies live in their own persistent Electron partition, so they survive
 * restarts and never mix with the app's own session.
 */

const PARTITION = 'persist:workvivo'

/** Cookie Laravel sets for an authenticated WorkVivo session. */
const SESSION_COOKIE = 'workvivo_session'
/** Cookie holding the (URL-encoded) XSRF token. */
const XSRF_COOKIE = 'XSRF-TOKEN'

export function workvivoSession(): Session {
  return session.fromPartition(PARTITION)
}

export interface WorkvivoWebAuth {
  origin: string
  /** 40-char token for `X-CSRF-Token`, from GET /refresh. */
  csrfToken: string
  /** Decoded `XSRF-TOKEN` cookie, for `X-XSRF-TOKEN`. */
  xsrfToken: string
}

async function cookieValue(origin: string, name: string): Promise<string | null> {
  const cookies = await workvivoSession().cookies.get({ url: origin, name })
  return cookies[0]?.value ?? null
}

/** True when the partition holds a session cookie for this tenant. */
export async function hasWorkvivoWebSession(url: string | undefined): Promise<boolean> {
  const origin = webOrigin(url)
  if (!origin) return false
  return (await cookieValue(origin, SESSION_COOKIE)) !== null
}

/** Forget the stored login. */
export async function clearWorkvivoWebSession(url: string | undefined): Promise<void> {
  const origin = webOrigin(url)
  const s = workvivoSession()
  if (!origin) {
    await s.clearStorageData({ storages: ['cookies'] })
    return
  }
  const cookies = await s.cookies.get({ url: origin })
  await Promise.all(
    cookies.map((c) =>
      s.cookies.remove(`https://${c.domain?.replace(/^\./, '')}${c.path ?? '/'}`, c.name).catch(() => undefined)
    )
  )
}

/**
 * Resolve the headers the web API needs, refreshing the CSRF token.
 *
 * `X-CSRF-Token` is short-lived and rotates, so it is fetched per post rather
 * than cached; `X-XSRF-TOKEN` is the session cookie value, URL-decoded.
 */
export async function getWorkvivoWebAuth(url: string | undefined): Promise<WorkvivoWebAuth> {
  const origin = webOrigin(url)
  if (!origin) {
    throw new WorkvivoWebError('Set your WorkVivo URL in Settings first.', undefined, true)
  }
  if (!(await cookieValue(origin, SESSION_COOKIE))) {
    throw new WorkvivoWebError(
      'Not signed in to WorkVivo in this app. Use “Sign in to WorkVivo” in Settings.',
      undefined,
      true
    )
  }
  const rawXsrf = await cookieValue(origin, XSRF_COOKIE)
  if (!rawXsrf) {
    throw new WorkvivoWebError(
      'Your WorkVivo session is missing its CSRF cookie. Sign in again from Settings.',
      undefined,
      true
    )
  }

  const res = await workvivoSession().fetch(refreshUrl(origin), {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  })
  if (res.status === 401 || res.status === 419) {
    throw new WorkvivoWebError(
      'Your WorkVivo session has expired. Sign in again from Settings.',
      res.status,
      true
    )
  }
  if (!res.ok) {
    throw new WorkvivoWebError(`Could not refresh the WorkVivo CSRF token (HTTP ${res.status}).`, res.status)
  }
  const body = (await res.json().catch(() => ({}))) as { token?: unknown }
  if (typeof body.token !== 'string' || !body.token) {
    throw new WorkvivoWebError('WorkVivo did not return a CSRF token. The internal API may have changed.')
  }

  return { origin, csrfToken: body.token, xsrfToken: decodeURIComponent(rawXsrf) }
}

/** Headers every authenticated web-API request carries. */
export function webAuthHeaders(auth: WorkvivoWebAuth): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': auth.csrfToken,
    'X-XSRF-TOKEN': auth.xsrfToken,
    Origin: auth.origin,
    Referer: `${auth.origin}/`
  }
}

/**
 * Open a real browser window on the tenant and resolve once the user has
 * signed in. SSO redirects to an identity provider and back, so success is
 * detected by the session cookie appearing rather than by any particular URL.
 */
export function openWorkvivoLogin(url: string | undefined): Promise<boolean> {
  const origin = webOrigin(url)
  if (!origin) {
    return Promise.reject(new WorkvivoWebError('Set your WorkVivo URL in Settings first.'))
  }

  return new Promise<boolean>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1024,
      height: 800,
      title: 'Sign in to WorkVivo',
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true }
    })

    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearInterval(poll)
      // Closing from inside its own event would fire 'closed' re-entrantly.
      setImmediate(() => {
        if (!win.isDestroyed()) win.close()
      })
      resolve(ok)
    }

    // Poll for the cookie rather than watching URLs: the SSO round trip can
    // land anywhere, and the cookie is the thing we actually need.
    const poll = setInterval(() => {
      if (win.isDestroyed()) return
      void cookieValue(origin, SESSION_COOKIE).then((v) => {
        if (v) finish(true)
      })
    }, 1000)

    win.on('closed', () => {
      if (done) return
      done = true
      clearInterval(poll)
      // Closed by hand before signing in.
      resolve(false)
    })

    win.loadURL(origin).catch((err) => {
      clearInterval(poll)
      if (!win.isDestroyed()) win.close()
      reject(new WorkvivoWebError(`Could not open WorkVivo (${String(err)}).`))
    })
  })
}
