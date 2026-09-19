import type { CutawanApi } from './index'

declare global {
  interface Window {
    cutawan: CutawanApi
  }
}

export {}
