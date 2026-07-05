/**
 * electron-updater stub for unit tests: the real package constructs a
 * platform updater (touching Electron APIs) as soon as `autoUpdater` is
 * accessed, which cannot work outside Electron. Tests only exercise the pure
 * logic in src/main/updates.ts, never the updater itself.
 */
export const autoUpdater = {} as never
