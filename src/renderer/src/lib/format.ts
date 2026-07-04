export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatTimecode(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function scoreColor(score: number): string {
  if (score >= 85) return '#4ade80'
  if (score >= 70) return '#a3e635'
  if (score >= 55) return '#facc15'
  if (score >= 40) return '#fb923c'
  return '#f87171'
}

export function scoreLabel(score: number): string {
  if (score >= 85) return 'Exceptional'
  if (score >= 70) return 'Strong'
  if (score >= 55) return 'Good'
  if (score >= 40) return 'Fair'
  return 'Weak'
}
