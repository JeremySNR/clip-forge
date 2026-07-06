import { describe, expect, it } from 'vitest'
import { buildFilterGraph } from '../src/main/pipeline/render'
import { DEFAULT_CAPTION_STYLE_ID } from '@shared/captionStyles'
import type { BrandingSettings, Clip, VideoInfo } from '@shared/types'

function makeClip(start = 0, end = 30): Clip {
  return {
    id: 'c1',
    suggestedStart: start,
    suggestedEnd: end,
    title: 't',
    hook: '',
    summary: '',
    viralityScore: 50,
    viralityReason: '',
    visualSummary: null,
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    broll: [],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      tightenCuts: false,
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID,
      showTitle: false,
      start,
      end
    }
  }
}

const source: VideoInfo = {
  path: '/tmp/source.mp4',
  fileName: 'source.mp4',
  durationSec: 300,
  width: 1920,
  height: 1080,
  fps: 30,
  sizeBytes: 1,
  hasAudio: true
}

const branding: BrandingSettings = {
  enabled: true,
  imagePath: '/tmp/logo.png',
  position: 'bottom-right',
  opacity: 0.8,
  scale: 0.16
}

describe('buildFilterGraph', () => {
  it('fades audio out at the clip tail', () => {
    const graph = buildFilterGraph(makeClip(), source, null, 30, null)
    expect(graph.filterComplex).toContain('afade=t=out:st=29.600:d=0.4')
  })

  it('skips the fade on very short clips', () => {
    const graph = buildFilterGraph(makeClip(0, 1), source, null, 1, null)
    expect(graph.filterComplex).not.toContain('afade')
  })

  it('overlays the branding watermark under the captions', () => {
    const graph = buildFilterGraph(makeClip(), source, '/tmp/subs.ass', 30, null, { branding })
    expect(graph.extraInputs).toContain('/tmp/logo.png')
    // 16% of 1080 output width, bottom-right with a 3% margin.
    expect(graph.filterComplex).toContain('scale=173:-1')
    expect(graph.filterComplex).toContain('colorchannelmixer=aa=0.800')
    expect(graph.filterComplex).toContain('overlay=W-w-32:H-h-32[wmk]')
    // Captions are burned in after (on top of) the watermark.
    expect(graph.filterComplex.indexOf('overlay=W-w-32')).toBeLessThan(
      graph.filterComplex.indexOf('ass=filename')
    )
  })

  it('positions the watermark per corner', () => {
    const at = (position: BrandingSettings['position']): string =>
      buildFilterGraph(makeClip(), source, null, 30, null, {
        branding: { ...branding, position }
      }).filterComplex
    expect(at('top-left')).toContain('overlay=32:32')
    expect(at('top-right')).toContain('overlay=W-w-32:32')
    expect(at('bottom-left')).toContain('overlay=32:H-h-32')
    expect(at('bottom-right')).toContain('overlay=W-w-32:H-h-32')
  })

  it('omits the watermark when branding is disabled or has no image', () => {
    const disabled = buildFilterGraph(makeClip(), source, null, 30, null, {
      branding: { ...branding, enabled: false }
    })
    expect(disabled.filterComplex).not.toContain('colorchannelmixer')
    const noImage = buildFilterGraph(makeClip(), source, null, 30, null, {
      branding: { ...branding, imagePath: null }
    })
    expect(noImage.filterComplex).not.toContain('colorchannelmixer')
  })

  it('pans the crop for within-shot focus moves and snaps at cuts', () => {
    const clip = makeClip()
    clip.edit.framing = 'auto'
    clip.focusTrack = [
      { t: 0, x: 0.5, cut: true },
      { t: 5, x: 0.62 }, // small within-shot move -> eased pan
      { t: 12, x: 0.2, cut: true } // speaker switch -> hard snap
    ]
    const graph = buildFilterGraph(clip, source, null, 30, null)
    // Eased (smoothstep) pan over the pan window starting at the keyframe.
    expect(graph.filterComplex).toContain('(t-5.000)/0.600')
    expect(graph.filterComplex).toContain('(3-2*')
    // The cut-flagged keyframe stays a hard constant step.
    expect(graph.filterComplex).toContain(',0.2000)')
  })

  it('applies auto zoom via the subpixel perspective filter, not zoompan', () => {
    const graph = buildFilterGraph(makeClip(), source, null, 30, null, {
      zoomEvents: [
        { start: 2, end: 2, from: 1, to: 1.12, style: 'cut' },
        { start: 6, end: 14, from: 1, to: 1.08, style: 'creep' }
      ]
    })
    // zoompan pans on whole pixels, which made slow creeps shake.
    expect(graph.filterComplex).not.toContain('zoompan')
    expect(graph.filterComplex).toContain('perspective=')
    expect(graph.filterComplex).toContain('interpolation=cubic:eval=frame[zoomed]')
  })

  it('uses the provided fontsdir for caption burn-in', () => {
    const graph = buildFilterGraph(makeClip(), source, '/tmp/subs.ass', 30, null, {
      fontsDirPath: '/custom/fonts'
    })
    expect(graph.filterComplex).toContain("fontsdir='/custom/fonts'")
  })
})
