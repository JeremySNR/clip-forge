import { describe, expect, it } from 'vitest'
import { findWholeVideoClip, highlightClips, isWholeVideoClip, wholeVideoEdit } from '@shared/wholeVideo'
import { DEFAULT_CAPTION_STYLE_ID } from '@shared/captionStyles'
import { compactFocusTrack } from '@shared/focusTrack'
import type { Clip, FocusKeyframe, Project } from '@shared/types'

function makeClip(id: string, origin?: Clip['origin']): Clip {
  return {
    id,
    origin,
    suggestedStart: 0,
    suggestedEnd: 30,
    title: id,
    hook: '',
    summary: '',
    viralityScore: 50,
    viralityReason: '',
    visualSummary: null,
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    broll: [],
    edit: wholeVideoEdit({ aspect: '9:16', autoZoom: false, durationSec: 30, focusTrack: null, contentType: 'speaker' })
  }
}

function makeProject(clips: Clip[]): Project {
  return {
    id: 'p1',
    createdAt: 0,
    updatedAt: 0,
    name: 'Project',
    video: {
      path: '/tmp/v.mp4',
      fileName: 'v.mp4',
      durationSec: 600,
      width: 1920,
      height: 1080,
      fps: 30,
      sizeBytes: 1,
      hasAudio: true
    },
    transcript: null,
    clips,
    prompt: '',
    videoType: 'auto'
  }
}

describe('wholeVideoEdit', () => {
  it('covers the whole video with captions on and tighten off', () => {
    const edit = wholeVideoEdit({
      aspect: '9:16',
      autoZoom: true,
      durationSec: 754.2,
      focusTrack: null,
      contentType: 'speaker'
    })
    expect(edit.start).toBe(0)
    expect(edit.end).toBe(754.2)
    expect(edit.captionsEnabled).toBe(true)
    expect(edit.autoZoom).toBe(true)
    // Across a whole video, tightening would cut the timeline into hundreds
    // of segments; it stays a deliberate choice in the editor.
    expect(edit.tightenCuts).toBe(false)
    expect(edit.captionStyleId).toBe(DEFAULT_CAPTION_STYLE_ID)
  })

  it('follows the speaker when a track was built, and centres when not', () => {
    const focusTrack: FocusKeyframe[] = [
      { t: 0, x: 0.7, cut: true },
      { t: 12, x: 0.3, cut: true }
    ]
    const tracked = wholeVideoEdit({
      aspect: '9:16',
      autoZoom: false,
      durationSec: 60,
      focusTrack,
      contentType: 'speaker'
    })
    expect(tracked.framing).toBe('auto')
    expect(tracked.focusX).toBe(0.7)

    const untracked = wholeVideoEdit({
      aspect: '9:16',
      autoZoom: false,
      durationSec: 60,
      focusTrack: null,
      contentType: 'speaker'
    })
    expect(untracked.framing).toBe('manual')
    expect(untracked.focusX).toBe(0.5)
  })

  it('letterboxes a screen recording instead of cropping it', () => {
    const edit = wholeVideoEdit({
      aspect: '9:16',
      autoZoom: true,
      durationSec: 60,
      focusTrack: null,
      contentType: 'screencast'
    })
    expect(edit.reframeMode).toBe('fit-letterbox')
    expect(edit.autoZoom).toBe(false)
  })

  it('keeps a caption look chosen on an earlier run', () => {
    const edit = wholeVideoEdit({
      aspect: '1:1',
      autoZoom: false,
      durationSec: 60,
      focusTrack: null,
      contentType: 'speaker',
      captionStyleId: 'hormozi',
      captionFontFamily: 'My Font'
    })
    expect(edit.aspect).toBe('1:1')
    expect(edit.captionStyleId).toBe('hormozi')
    expect(edit.captionFontFamily).toBe('My Font')
  })
})

describe('clip origins', () => {
  it('separates the full-video edit from AI-found clips', () => {
    const whole = makeClip('whole', 'whole-video')
    const project = makeProject([whole, makeClip('a', 'ai-highlight'), makeClip('b')])

    expect(isWholeVideoClip(whole)).toBe(true)
    expect(findWholeVideoClip(project)?.id).toBe('whole')
    // An absent origin is an AI highlight (clips saved before the mode existed).
    expect(highlightClips(project).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('reports no full-video edit when a project has none', () => {
    expect(findWholeVideoClip(makeProject([makeClip('a')]))).toBe(null)
  })
})

describe('compactFocusTrack', () => {
  it('drops keyframes that neither move the crop nor mark a cut', () => {
    const track: FocusKeyframe[] = [
      { t: 0, x: 0.5, cut: true },
      { t: 1.5, x: 0.502 },
      { t: 3, x: 0.501 },
      { t: 4.5, x: 0.62 },
      { t: 6, x: 0.62, cut: true }
    ]
    expect(compactFocusTrack(track)).toEqual([
      { t: 0, x: 0.5, cut: true },
      { t: 4.5, x: 0.62 },
      { t: 6, x: 0.62, cut: true }
    ])
  })

  it('keeps everything in a track that already moves', () => {
    const track: FocusKeyframe[] = [
      { t: 0, x: 0.3, cut: true },
      { t: 2, x: 0.7, cut: true },
      { t: 4, x: 0.3, cut: true }
    ]
    expect(compactFocusTrack(track)).toEqual(track)
  })
})
