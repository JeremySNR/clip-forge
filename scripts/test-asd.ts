/**
 * Debug / validation harness for audio-visual active speaker detection.
 *
 * Runs the ASD analysis on a range of a local video, prints each face
 * track's speaking-score timeline, the selected focus and the resulting
 * focus keyframes, and (with --annotate) writes frames with face boxes
 * coloured by speaking state plus the chosen crop window.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-asd.ts <video> [start] [end] [--annotate out-dir]
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { analyzeClipASD, ASD_FPS } from '../src/main/pipeline/asd'
import { chooseSpeakerByScores } from '../src/main/pipeline/speaker'
import { buildFocusTrack } from '../src/main/pipeline/faces'
import { focusAt } from '../src/shared/focusTrack'
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const annotateIdx = process.argv.indexOf('--annotate')
  const annotateDir = annotateIdx !== -1 ? process.argv[annotateIdx + 1] : null
  const videoPath = args[0]
  if (!videoPath) {
    console.error('usage: test-asd.ts <video> [start] [end] [--annotate out-dir]')
    process.exit(1)
  }
  const info = await probeVideo(videoPath)
  const start = args[1] ? Number(args[1]) : 0
  const end = args[2] ? Number(args[2]) : Math.min(start + 30, info.durationSec)
  console.log(`${info.width}x${info.height} ${info.fps}fps hasAudio=${info.hasAudio}`)
  console.log(`analyzing ${start}s..${end}s\n`)

  const t0 = Date.now()
  const analysis = await analyzeClipASD(videoPath, start, end, undefined)
  if (!analysis) {
    console.error('ASD models unavailable')
    process.exit(1)
  }
  console.log(
    `analysis took ${((Date.now() - t0) / 1000).toFixed(1)}s for ${(end - start).toFixed(0)}s of video`
  )
  console.log(
    `${analysis.frameCount} frames, ${analysis.tracks.length} track(s), scene cuts at [${analysis.sceneCuts
      .map((f) => (start + f / ASD_FPS).toFixed(1))
      .join(', ')}]\n`
  )

  // Per-second ASCII timeline per track: '#' speaking, '.' silent, ' ' absent.
  for (let t = 0; t < analysis.tracks.length; t++) {
    const track = analysis.tracks[t]
    const meanCentre = track.centres.reduce((a, b) => a + b, 0) / track.centres.length
    const speakingFrac =
      track.scores.filter((s) => s > 0).length / Math.max(1, track.scores.length)
    let line = ''
    for (let sec = 0; sec * ASD_FPS < analysis.frameCount; sec++) {
      const from = Math.max(sec * ASD_FPS, track.start)
      const to = Math.min((sec + 1) * ASD_FPS, track.start + track.scores.length)
      if (to <= from) {
        line += ' '
        continue
      }
      let sum = 0
      for (let f = from; f < to; f++) sum += track.scores[f - track.start]
      line += sum / (to - from) > 0 ? '#' : '.'
    }
    console.log(
      `track ${t}: x=${meanCentre.toFixed(2)} span=${(track.start / ASD_FPS + start).toFixed(1)}s+${(
        track.scores.length / ASD_FPS
      ).toFixed(1)}s speaking=${(speakingFrac * 100).toFixed(0)}%`
    )
    console.log(`  ${line}`)
  }

  const { centres, switchCuts } = chooseSpeakerByScores(
    analysis.tracks,
    analysis.frameCount,
    analysis.sceneCuts,
    ASD_FPS
  )
  const cuts = [...new Set([...analysis.sceneCuts, ...switchCuts])].sort((a, b) => a - b)
  let focusLine = ''
  for (let sec = 0; sec * ASD_FPS < analysis.frameCount; sec++) {
    const c = centres[Math.min(centres.length - 1, sec * ASD_FPS + Math.floor(ASD_FPS / 2))]
    focusLine += c === null ? ' ' : c < 0.33 ? 'L' : c < 0.66 ? 'C' : 'R'
  }
  console.log(`\nfocus:    ${focusLine}`)
  console.log(`speaker switches at [${switchCuts.map((f) => (start + f / ASD_FPS).toFixed(1)).join(', ')}]`)

  const track = buildFocusTrack(centres, start, cuts, ASD_FPS)
  console.log(
    `\nfocus keyframes: ${track ? track.map((k) => `t=${k.t.toFixed(1)} x=${k.x.toFixed(2)}`).join(', ') : 'null'}`
  )

  if (annotateDir && track) {
    await mkdir(annotateDir, { recursive: true })
    // One annotated frame per second: drawbox for each face (thick = speaking)
    // plus the 9:16 crop window at the selected focus.
    for (let sec = 0; sec + 1 < (end - start); sec += 2) {
      const f = Math.min(analysis.frameCount - 1, Math.round((sec + 0.5) * ASD_FPS))
      const boxes: string[] = []
      for (const tr of analysis.tracks) {
        const i = f - tr.start
        if (i < 0 || i >= tr.centres.length) continue
        const speaking = tr.scores[i] > 0
        const w = Math.sqrt(tr.areas[i]) // rough: area = w*h, assume squarish
        const x = tr.centres[i] - w / 2
        boxes.push(
          `drawbox=x=iw*${x.toFixed(3)}:y=ih*0.05:w=iw*${w.toFixed(3)}:h=ih*0.9:color=${speaking ? 'lime' : 'red'}:t=${speaking ? 6 : 2}`
        )
      }
      // The 9:16 crop window as the renderer positions it: x = (iw-ow)*focus.
      const focus = focusAt(track, start + sec + 0.5)
      const cropW = (info.height * 9) / 16 / info.width
      boxes.push(
        `drawbox=x=iw*${((1 - cropW) * focus).toFixed(3)}:y=0:w=iw*${cropW.toFixed(3)}:h=ih:color=yellow:t=4`
      )
      await runFfmpeg([
        '-ss', (start + sec + 0.5).toFixed(3),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', boxes.join(','),
        '-q:v', '4',
        join(annotateDir, `asd-${String(sec).padStart(4, '0')}.jpg`)
      ])
    }
    console.log(`\nannotated frames written to ${annotateDir}`)
  }
}

main().catch((err) => {
  console.error('ASD test FAILED:', err)
  process.exit(1)
})
