/** Build and run a bounded live provider check in an isolated Electron profile.
 * Configuration contains paths/models only. API credentials come from the environment.
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout, clearTimeout } from 'node:timers'

const require = createRequire(import.meta.url)
const [configurationPath, outputPath] = process.argv.slice(2)
if (!configurationPath || !outputPath || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/provider-smoke.mjs <safe-config.json> <new-output-dir>')
}
const configPath = resolve(configurationPath), output = resolve(outputPath)
const configuration = JSON.parse(await readFile(configPath, 'utf8'))
if (configuration.apiKey || configuration.token || configuration.auth) throw new Error('Do not put credentials in the smoke configuration')
await mkdir(output) // Refuse to reuse a previous experiment or its isolated usage ledger.
const entry = resolve(output, 'provider-smoke.cjs')
await build({ entryPoints: ['scripts/provider-smoke-main.ts'], outfile: entry, bundle: true, platform: 'node',
  format: 'cjs', target: 'node20', tsconfig: 'tsconfig.node.json',
  external: ['electron', 'ffmpeg-static', '@ffprobe-installer/ffprobe', 'onnxruntime-node'], logLevel: 'warning' })
const env = { ...process.env, CUTAWAN_PROVIDER_SMOKE_CONFIG: configPath, CUTAWAN_PROVIDER_SMOKE_OUTPUT: output }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const child = spawn(require('electron'), [entry, '--disable-gpu'], { env, stdio: 'inherit', windowsHide: true })
const deadline = setTimeout(() => child.kill(), 12 * 60_000)
child.once('error', error => { clearTimeout(deadline); console.error(error.message); process.exitCode = 1 })
child.once('close', code => { clearTimeout(deadline); process.exitCode = code ?? 1 })
