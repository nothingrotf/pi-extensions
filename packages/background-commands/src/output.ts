import { StringDecoder } from 'node:string_decoder'

import type { CommandOutput } from './schema.ts'

export function outputTail(text: string, maxBytes: number, maxLines: number): CommandOutput {
  const bytes = Buffer.from(text, 'utf8')
  let offset = Math.max(0, bytes.length - maxBytes)
  while (offset < bytes.length && ((bytes[offset] ?? 0) & 192) === 128) offset += 1
  const lines = bytes.subarray(offset).toString('utf8').split('\n')
  return {
    text: lines.slice(-maxLines).join('\n'),
    truncated: offset > 0 || lines.length > maxLines,
  }
}

export class CommandLog {
  private readonly decoder = new StringDecoder('utf8')
  private current: CommandOutput | undefined = { text: '', truncated: false }
  private ended = false

  append(bytes: Buffer): void {
    if (this.ended) return
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      this.add(this.decoder.write(bytes.subarray(offset, offset + 8192)))
    }
  }

  finish(): void {
    if (this.ended) return
    this.ended = true
    this.add(this.decoder.end())
  }

  release(): void {
    this.ended = true
    this.current = undefined
  }

  read(): CommandOutput | undefined {
    return this.current === undefined ? undefined : { ...this.current }
  }

  private add(text: string): void {
    if (this.current === undefined || text.length === 0) return
    const next = outputTail(this.current.text + text, 50 * 1024, 2000)
    this.current = { text: next.text, truncated: this.current.truncated || next.truncated }
  }
}
