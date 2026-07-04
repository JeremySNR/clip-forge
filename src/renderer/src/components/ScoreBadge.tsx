import { Flame } from 'lucide-react'
import { scoreColor, scoreLabel } from '../lib/format'

export default function ScoreBadge({
  score,
  size = 'sm'
}: {
  score: number
  size?: 'sm' | 'lg'
}): React.JSX.Element {
  const color = scoreColor(score)
  if (size === 'lg') {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border px-3 py-2"
        style={{ borderColor: `${color}55`, backgroundColor: `${color}14` }}
      >
        <Flame size={18} style={{ color }} />
        <div>
          <div className="text-lg font-bold leading-none tabular-nums" style={{ color }}>
            {score}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
            {scoreLabel(score)}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums backdrop-blur"
      style={{ backgroundColor: `${color}26`, color }}
    >
      <Flame size={12} />
      {score}
    </div>
  )
}
