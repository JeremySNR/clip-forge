import { appendFile, mkdtemp, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FaceCrops } from './asdFrontend'

const FRAME_BYTES = 112 * 112
const MEMORY_LIMIT = 64 * 1024 * 1024

/** Short clips stay in memory; long tracks spool in one-second blocks. */
export class FaceCropStore {
  private readonly buffers: Uint8Array[][]
  private readonly counts: number[]

  private constructor(tracks: number, private readonly directory?: string) {
    this.buffers = Array.from({ length: tracks }, () => [])
    this.counts = Array(tracks).fill(0)
  }

  static async create(lengths: number[], memoryLimit = MEMORY_LIMIT): Promise<FaceCropStore> {
    const spill = lengths.reduce((sum, n) => sum + n, 0) * FRAME_BYTES > memoryLimit
    return new FaceCropStore(lengths.length, spill ? await mkdtemp(join(tmpdir(), 'cutawan-crops-')) : undefined)
  }

  async push(track: number, crop: Uint8Array): Promise<void> {
    if (crop.length !== FRAME_BYTES) throw new Error('Invalid face crop size')
    this.buffers[track].push(crop)
    this.counts[track]++
    if (this.directory && this.buffers[track].length >= 25) await this.flush(track)
  }

  private async flush(track: number): Promise<void> {
    const buffer = this.buffers[track]
    if (!this.directory || !buffer.length) return
    await appendFile(join(this.directory, `${track}.gray`), Buffer.concat(buffer))
    this.buffers[track] = []
  }

  async finish(track: number): Promise<void> { await this.flush(track) }

  async read<T>(track: number, work: (crops: FaceCrops) => Promise<T>): Promise<T> {
    if (!this.directory || !this.counts[track]) return work(this.buffers[track])
    await this.flush(track)
    const file = await open(join(this.directory, `${track}.gray`), 'r')
    try {
      return await work({ length: this.counts[track], slice: async (from, to) => {
        if (from < 0 || to > this.counts[track] || from > to) throw new Error('Invalid crop window')
        const buffer = Buffer.alloc((to - from) * FRAME_BYTES)
        let offset = 0
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, from * FRAME_BYTES + offset)
          if (!bytesRead) throw new Error('Incomplete face crop file')
          offset += bytesRead
        }
        return Array.from({ length: to - from }, (_, i) => buffer.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES))
      } })
    } finally { await file.close() }
  }

  async close(): Promise<void> {
    this.buffers.length = 0
    if (this.directory) await rm(this.directory, { recursive: true, force: true })
  }
}
