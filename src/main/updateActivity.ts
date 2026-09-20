/** Keep update restarts out of in-flight IPC work, including saves and imports. */
export class UpdateActivity {
  private active = 0

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    this.active++
    try { return await operation() }
    finally { this.active-- }
  }

  requireIdle(): void {
    if (this.active > 0) throw new Error('Wait for saving, imports, analysis and exports to finish before restarting.')
  }
}
