import type { ClipForgeApi } from './index'

declare global {
  interface Window {
    clipforge: ClipForgeApi
  }
}

export {}
