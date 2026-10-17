import { describe, expect, it } from 'vite-plus/test'

import { CommandLog, outputTail } from '../src/output.ts'

describe('bounded command output', () => {
  it('preserves UTF-8 across every possible split in a multibyte sample', () => {
    const sample = 'start á中😀\nend\n'
    const bytes = Buffer.from(sample)
    for (let split = 0; split <= bytes.length; split += 1) {
      const log = new CommandLog()
      log.append(bytes.subarray(0, split))
      log.append(bytes.subarray(split))
      log.finish()
      expect(log.read()).toEqual({ text: sample, truncated: false })
    }
  })

  it('bounds bytes without splitting code points for varied tail sizes', () => {
    const input = 'á中😀'.repeat(100)
    for (let maxBytes = 1; maxBytes < 100; maxBytes += 1) {
      const result = outputTail(input, maxBytes, 2000)
      expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(maxBytes)
      expect(input.endsWith(result.text)).toBe(true)
      expect(result.text).not.toContain('\uFFFD')
      expect(result.truncated).toBe(true)
    }
  })

  it('retains newest lines and keeps truncation visible after later small chunks', () => {
    const log = new CommandLog()
    log.append(Buffer.from(Array.from({ length: 3000 }, (_, index) => `line ${index}`).join('\n')))
    log.append(Buffer.from('\nlast\n'))
    log.finish()
    const output = log.read()
    expect(output?.text.endsWith('line 2999\nlast\n')).toBe(true)
    expect(output?.text.split('\n').length).toBeLessThanOrEqual(2000)
    expect(output?.truncated).toBe(true)
  })

  it('bounds huge individual chunks and exposes detached snapshots', () => {
    const log = new CommandLog()
    log.append(Buffer.from('á😀'.repeat(100_000)))
    const output = log.read()
    expect(output?.truncated).toBe(true)
    expect(Buffer.byteLength(output?.text ?? '')).toBeLessThanOrEqual(50 * 1024)
    expect(output?.text).not.toContain('\uFFFD')
    if (output !== undefined) Object.assign(output, { text: 'tampered' })
    expect(log.read()?.text).not.toBe('tampered')
  })

  it('finalizes invalid trailing UTF-8 and releases output permanently', () => {
    const log = new CommandLog()
    log.append(Buffer.from([0x61, 0xf0, 0x9f]))
    log.finish()
    log.finish()
    expect(log.read()?.text).toBe('a\uFFFD')
    log.append(Buffer.from('ignored'))
    expect(log.read()?.text).toBe('a\uFFFD')
    log.release()
    log.append(Buffer.from('ignored'))
    expect(log.read()).toBeUndefined()
  })
})
