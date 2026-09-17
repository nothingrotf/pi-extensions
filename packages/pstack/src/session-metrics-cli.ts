import { readFile } from 'node:fs/promises'

import {
  compareSessionMetrics,
  formatSessionComparison,
  formatSessionMetrics,
  sessionMetrics,
} from './session-metrics.ts'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const compare = args.includes('--compare')
const paths = args.filter((entry) => entry !== '--json' && entry !== '--compare')

async function metricsOf(path: string) {
  return sessionMetrics(await readFile(path, 'utf8'))
}

if (paths.length === 0 || (compare && paths.length !== 2)) {
  process.stderr.write(
    'Usage: bun session-metrics-cli.ts [--json] <session.jsonl> [more.jsonl]\n       bun session-metrics-cli.ts --compare [--json] <baseline.jsonl> <candidate.jsonl>\n',
  )
  process.exitCode = 2
} else if (compare) {
  const [baselinePath, candidatePath] = paths
  if (baselinePath === undefined || candidatePath === undefined) {
    process.stderr.write('A comparison needs a baseline path and a candidate path.\n')
    process.exitCode = 2
  } else {
    try {
      const baseline = await metricsOf(baselinePath)
      const candidate = await metricsOf(candidatePath)
      const comparison = compareSessionMetrics(baseline, candidate)
      process.stdout.write(
        asJson
          ? `${JSON.stringify({ baseline: baselinePath, candidate: candidatePath, ...comparison }, null, 2)}\n`
          : `baseline ${baselinePath}\ncandidate ${candidatePath}\n${formatSessionComparison(comparison)}\n`,
      )
    } catch {
      process.stderr.write('Cannot read one of the session files.\n')
      process.exitCode = 1
    }
  }
} else {
  for (const path of paths) {
    try {
      const metrics = await metricsOf(path)
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
