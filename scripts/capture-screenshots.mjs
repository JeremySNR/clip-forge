/** Cross-platform, offline screenshot walk using an isolated demo profile. */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const output = resolve(process.argv[2] ?? '.tmp/cutawan-screenshots')
const profile = resolve(output, 'profile')
mkdirSync(output, { recursive: true })
const env = {
  ...process.env, CUTAWAN_USER_DATA: profile,
  CUTAWAN_FAKE_LATEST: require('../package.json').version
}
delete env.ELECTRON_RUN_AS_NODE
delete env.OPENAI_API_KEY
delete env.ELECTRON_RENDERER_URL

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    env: { ...env, ...extraEnv }, stdio: 'inherit', timeout: 240_000, windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

run(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'])
run(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.node.json', 'scripts/seed-demo.ts'])
run(require('electron'), ['.', '--disable-gpu'], { CUTAWAN_SMOKE: output })
console.log(`Cutawan screenshots saved to ${output}`)
