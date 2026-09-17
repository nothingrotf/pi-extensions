import { readFile } from 'node:fs/promises'

import { formatSessionMetrics, sessionMetrics } from './session-metrics.ts'

const paths = process.argv.slice(2).filter((entry) => entry !== '--json')
const asJson = process.argv.includes('--json')
if (paths.length === 0) {
  process.stderr.write('Usage: bun session-metrics-cli.ts [--json] <session.jsonl> [more.jsonl]\n')
  process.exitCode = 2
} else {
  for (const path of paths) {
    try {
      const metrics = sessionMetrics(await readFile(path, 'utf8'))
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ path, ...metrics }, null, 2)}\n`)
      } else {
        process.stdout.write(`${path}\n${formatSessionMetrics(metrics)}\n\n`)
      }
    } catch {
      process.stderr.write(`Cannot read the session file: ${path}\n`)
      process.exitCode = 1
    }
  }
}
