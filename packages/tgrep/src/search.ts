import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import {
  type GrepToolDetails,
  type GrepToolInput,
  truncateHead,
  truncateLine,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

const eventSchema = Type.Object({
  type: Type.String(),
  data: Type.Object({
    path: Type.Object({ text: Type.String() }),
    line_number: Type.Integer({ minimum: 1 }),
    lines: Type.Object({ text: Type.String() }),
  }),
})

export async function search(
  input: GrepToolInput,
  cwd: string,
  indexed = false,
  executable = 'tgrep',
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const rawPath = (input.path || '.').replace(/^@/, '')
  const searchPath = resolve(
    cwd,
    rawPath === '~' ? homedir() : rawPath.replace(/^~\//, `${homedir()}/`),
  )
  const directory = (await stat(searchPath)).isDirectory()
  const limit = Math.max(1, Math.floor(input.limit ?? 100))
  const context = Math.max(0, Math.floor(input.context ?? 0))
  if (!Number.isFinite(limit) || !Number.isFinite(context)) {
    throw new Error('limit and context must be finite numbers')
  }
  const args = ['--json', '--color=never', '--no-max-filesize']
  if (!indexed) args.push('--no-index', '--hidden')
  if (input.ignoreCase) args.push('--ignore-case')
  if (input.literal) args.push('--fixed-strings')
  if (input.glob) args.push('--glob', input.glob)
  if (context) args.push('--context', String(context))
  args.push('--', input.pattern, searchPath)
  const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let failure: Error | undefined
  const closed = new Promise<number | null>((done) => {
    child.on('error', (error) => {
      failure = new Error(
        `Cannot run tgrep. Install Microsoft tgrep and ensure it is on PATH. ${error.message}`,
      )
    })
    child.on('close', done)
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(0, 8192)
  })
  const stop = () => {
    child.kill('SIGKILL')
  }
  const deadline = setTimeout(() => {
    failure = new Error('tgrep search timed out after 120 seconds')
    stop()
  }, 120_000)
  signal?.addEventListener('abort', stop, { once: true })
  if (signal?.aborted) stop()
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const output: string[] = []
  const details: GrepToolDetails = {}
  let matches = 0
  let bytes = 0
  let limited = false
  try {
    for await (const line of lines) {
      const event: unknown = JSON.parse(line)
      if (!Value.Check(eventSchema, event)) continue
      if (event.type !== 'match' && event.type !== 'context') continue
      if (event.type === 'match') {
        if (matches >= limit) {
          details.matchLimitReached = limit
          limited = true
          break
        }
        matches++
      }
      const filePath = resolve(cwd, event.data.path.text)
      const displayPath = directory
        ? relative(searchPath, filePath).replaceAll('\\', '/')
        : basename(filePath)
      const text = event.data.lines.text.replace(/\r?\n$/, '')
      const truncated = truncateLine(text)
      if (truncated.wasTruncated) details.linesTruncated = true
      const separator = event.type === 'match' ? ':' : '-'
      const row = `${displayPath}${separator}${event.data.line_number}${separator} ${truncated.text}`
      output.push(row)
      bytes += Buffer.byteLength(row) + 1
      if (bytes > 50 * 1024 || output.length > 2000) {
        limited = true
        break
      }
    }
  } catch (error) {
    stop()
    throw error
  } finally {
    lines.close()
    if (limited) stop()
    await closed
    clearTimeout(deadline)
    signal?.removeEventListener('abort', stop)
  }
  signal?.throwIfAborted()
  if (failure) throw failure
  const code = await closed
  if (!limited && code !== 0 && code !== 1) {
    throw new Error(stderr.trim() || `tgrep exited with code ${code}`)
  }
  const truncation = truncateHead(output.join('\n'))
  if (truncation.truncated) details.truncation = truncation
  const notices: string[] = []
  if (details.matchLimitReached)
    notices.push(`${limit} matches limit reached. Increase limit or narrow the search.`)
  if (truncation.truncated)
    notices.push('Output truncated to 50KB or 2000 lines. Narrow the search for more results.')
  if (details.linesTruncated)
    notices.push('Some lines truncated to 500 characters. Use read for full lines.')
  if (indexed)
    notices.push(
      'Indexed mode can omit hidden files and recent changes. Use fresh mode for exhaustive searches.',
    )
  if (stderr.trim()) notices.push(`tgrep: ${stderr.trim()}`)
  const text = truncation.content || 'No matches found'
  return {
    content: [
      {
        type: 'text',
        text: notices.length ? `${text}\n\n[${notices.join('\n')}]` : text,
      } satisfies { type: 'text'; text: string },
    ],
    details,
  }
}
