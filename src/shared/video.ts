/** Video container extensions ClipForge accepts, without the leading dot. */
export const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  'mpg',
  'mpeg',
  'wmv'
] as const

/** True when a file path/name has one of the accepted video extensions. */
export function isVideoFile(pathOrName: string): boolean {
  const dot = pathOrName.lastIndexOf('.')
  if (dot === -1) return false
  const ext = pathOrName.slice(dot + 1).toLowerCase()
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext)
}
