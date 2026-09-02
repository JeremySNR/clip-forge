import { describe, expect, it } from 'vitest'
import {
  buildPostBody,
  postIdFromResponse,
  postPermalink,
  postsUrl,
  refreshUrl,
  signatureUrl,
  videoFromSignature,
  webOrigin,
  WorkvivoWebError,
  type WorkvivoS3Signature
} from '@shared/workvivoWeb'

/**
 * Shaped after a real exchange captured from the WorkVivo web app, so a change
 * to their internal API shows up here as a failing expectation rather than as
 * a silently malformed post.
 */
function signature(overrides: Partial<WorkvivoS3Signature> = {}): WorkvivoS3Signature {
  return {
    mimeType: 'video/mp4',
    attributes: {
      action: 'https://example-uploads.s3.eu-west-1.amazonaws.com',
      method: 'POST',
      enctype: 'multipart/form-data'
    },
    inputs: {
      acl: 'private',
      key: 'uploads/1583/6382403/a2fG0dKGokeP4Xe3TkECPkMpwbPaL7WbVRK17DRr.mp4',
      'Content-Type': 'video/mp4',
      'X-Amz-Security-Token': 'tok',
      'X-Amz-Credential': 'cred',
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Date': '20260827T105553Z',
      Policy: 'policy',
      'X-Amz-Signature': 'a'.repeat(64)
    },
    wvSignature: 'b'.repeat(64),
    ...overrides
  }
}

describe('webOrigin', () => {
  it('reduces a tenant URL to a bare origin', () => {
    expect(webOrigin('https://acme.workvivo.com')).toBe('https://acme.workvivo.com')
    expect(webOrigin('acme.workvivo.com')).toBe('https://acme.workvivo.com')
    expect(webOrigin('https://acme.workvivo.com/feed?x=1')).toBe('https://acme.workvivo.com')
  })

  it('always upgrades to https', () => {
    expect(webOrigin('http://acme.workvivo.com')).toBe('https://acme.workvivo.com')
  })

  it('rejects values that are not hosts', () => {
    expect(webOrigin('')).toBeNull()
    expect(webOrigin(undefined)).toBeNull()
    expect(webOrigin('localhost')).toBeNull()
  })
})

describe('endpoint URLs', () => {
  const origin = 'https://acme.workvivo.com'

  it('builds the signature URL with the params the endpoint expects', () => {
    const u = new URL(signatureUrl(origin, { extension: 'mp4', durationSec: 316.4, cacheBust: '0.5' }))
    expect(u.origin + u.pathname).toBe(`${origin}/api/s3/signature/generate`)
    expect(u.searchParams.get('extension')).toBe('mp4')
    expect(u.searchParams.get('cacheBust')).toBe('0.5')
    // The web app sends whole seconds.
    expect(u.searchParams.get('duration')).toBe('316')
  })

  it('never sends a negative duration', () => {
    const u = new URL(signatureUrl(origin, { extension: 'mp4', durationSec: -5, cacheBust: 'x' }))
    expect(u.searchParams.get('duration')).toBe('0')
  })

  it('points at the CSRF and posts endpoints', () => {
    expect(refreshUrl(origin)).toBe(`${origin}/refresh`)
    expect(postsUrl(origin)).toBe(`${origin}/api/posts`)
  })
})

describe('videoFromSignature', () => {
  it('replays the key and both signatures verbatim', () => {
    const sig = signature()
    const video = videoFromSignature(sig, 481481240)
    expect(video.path).toBe(sig.inputs.key)
    expect(video.amzSignature).toBe(sig.inputs['X-Amz-Signature'])
    expect(video.wvSignature).toBe(sig.wvSignature)
    expect(video.size).toBe(481481240)
    expect(video.mime).toBe('video/mp4')
  })

  it('fails loudly when the signature shape changes', () => {
    const noKey = signature()
    delete (noKey.inputs as Record<string, string>).key
    expect(() => videoFromSignature(noKey, 1)).toThrow(WorkvivoWebError)

    const noWv = signature({ wvSignature: '' })
    expect(() => videoFromSignature(noWv, 1)).toThrow(WorkvivoWebError)
  })
})

describe('buildPostBody', () => {
  const video = videoFromSignature(signature(), 481481240)

  it('targets the space with a numeric id', () => {
    const body = buildPostBody({ text: 'test', spaceId: '101344', video })
    expect(body.audience).toEqual({ type: 'spaces', spaces: [{ id: 101344 }], teams: [] })
  })

  it('keeps a non-numeric space id rather than sending NaN', () => {
    const body = buildPostBody({ text: 'test', spaceId: 'abc', video })
    expect(body.audience).toEqual({ type: 'spaces', spaces: [{ id: 'abc' }], teams: [] })
  })

  it('publishes immediately and carries the video descriptor', () => {
    const body = buildPostBody({ text: 'hello', spaceId: '1', video })
    expect(body.text).toBe('hello')
    expect(body.video).toBe(video)
    expect(body.draft_post).toEqual({ status: 'publish', item: {} })
    expect(body.videoUploadProgress).toBe(100)
    expect(body.publish_at).toBeNull()
  })

  it('sends every field the web app sends, so the endpoint sees a familiar shape', () => {
    const body = buildPostBody({ text: 'x', spaceId: '1', video })
    for (const key of [
      'text', 'audience', 'kudos_recipients', 'goal', 'images', 'video', 'link', 'poll',
      'attachments', 'publish_at', 'social_sharing', 'acknowledgement', 'draft_post',
      'campaigns', 'classifications', 'disable_comments', 'videoUploadProgress'
    ]) {
      expect(body, `missing ${key}`).toHaveProperty(key)
    }
  })

  it('serialises to JSON without losing anything', () => {
    const body = buildPostBody({ text: 'x', spaceId: '1', video })
    expect(JSON.parse(JSON.stringify(body))).toEqual(body)
  })
})

describe('postIdFromResponse', () => {
  it('reads the id from a success response', () => {
    expect(postIdFromResponse({ success: true, data: { id: 1234567 } })).toBe('1234567')
    expect(postIdFromResponse({ data: { id: 'abc' } })).toBe('abc')
  })

  it('returns null for anything unfamiliar', () => {
    expect(postIdFromResponse(null)).toBeNull()
    expect(postIdFromResponse({})).toBeNull()
    expect(postIdFromResponse({ data: {} })).toBeNull()
    expect(postIdFromResponse('nope')).toBeNull()
  })

  it('builds a permalink', () => {
    expect(postPermalink('https://acme.workvivo.com', '1234567')).toBe(
      'https://acme.workvivo.com/posts/1234567'
    )
  })
})
