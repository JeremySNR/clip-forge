import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fontsDir } from './captions'

/** Escape the option value, then the filter graph; never shell-quote again. */
const filterValue = (path: string): string =>
  path.replace(/\\/g, '/').replace(/[':]/g, '\\$&').replace(/[\\'[\],;]/g, '\\$&')

/** Use the shipped caption renderer: drawtext is absent from some bundled
 * FFmpeg builds. Proof dimensions are 1360×672 including the 32px label band. */
export async function reviewPanelLabels(directory: string, fontDirectory = fontsDir()): Promise<string> {
  const path = join(directory, 'labels.ass')
  const events = [['SOURCE reference', 12], ['BEFORE', 652], ['AFTER - judge here', 1012]]
    .map(([text, x]) => `Dialogue: 0,0:00:00.00,0:00:01.00,Label,,0,0,0,,{\\an7\\pos(${x},5)}${text}`).join('\n')
  await writeFile(path, `[Script Info]
ScriptType: v4.00+
PlayResX: 1360
PlayResY: 672
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Label,Poppins,18,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`)
  return `setpts=PTS-STARTPTS,ass=filename=${filterValue(path)}:fontsdir=${filterValue(fontDirectory)}`
}
