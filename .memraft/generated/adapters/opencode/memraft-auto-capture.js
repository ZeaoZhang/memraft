// Managed by Memraft. Do not edit manually.
import { spawn } from 'node:child_process'

const NODE_CODE = "import fs from 'node:fs';\nimport path from 'node:path';\nimport { pathToFileURL } from 'node:url';\nlet hookDir = null;\nconst current = path.resolve(process.cwd());\nconst candidates = [current];\nlet cursor = current;\nwhile (true) { const parent = path.dirname(cursor); if (parent === cursor) break; candidates.push(parent); cursor = parent; }\nfor (const candidate of candidates) {\n  const possible = path.join(candidate, '.memraft', 'hooks');\n  if (fs.existsSync(possible) && fs.statSync(possible).isDirectory()) { hookDir = possible; break; }\n}\nif (!hookDir) { process.exit(0); }\nconst mod = await import(pathToFileURL(path.join(hookDir, 'auto_capture.mjs')).href);\nconst exitCode = await mod.main([\"--tool\",\"opencode\"].concat(process.argv.slice(1)));\nif (Number.isInteger(exitCode)) { process.exit(exitCode); }"

function fire(eventType, event) {
  try {
    const child = spawn('node', [
      '--input-type=module',
      '-e',
      NODE_CODE,
      `--event-type=${eventType}`,
      JSON.stringify(event ?? {})
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (_error) {
  }
}

export const MemraftAutoCapturePlugin = async () => ({
  event: async ({ event }) => {
    const eventType = event?.type
    if (eventType === 'session.idle' || eventType === 'session.error') {
      fire(eventType, event)
    }
  }
})
