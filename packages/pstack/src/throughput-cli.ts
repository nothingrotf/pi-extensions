import { readFile } from 'node:fs/promises'

import { parseMeasurements, reportThroughput } from './throughput.ts'

const path = process.argv[2]
if (path === undefined || process.argv.length !== 3) {
  process.stderr.write('Usage: bun throughput-cli.ts <measurements.json>\n')
  process.exitCode = 2
} else {
  try {
    const result = parseMeasurements(await readFile(path, 'utf8'))
    if (result.ok) {
      process.stdout.write(`${JSON.stringify(reportThroughput(result.measurements), null, 2)}\n`)
    } else {
      process.stderr.write(`${result.error}\n`)
      process.exitCode = 1
    }
  } catch {
    process.stderr.write('Cannot read the delivery measurements file.\n')
    process.exitCode = 1
  }
}
