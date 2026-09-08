import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { expect, it } from 'vite-plus/test'

const exec = promisify(execFile)

it('expands aliases through the real Pi CLI and native resource catalog', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inline-skill-cli-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(
      'data: {"id":"test","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    )
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!(address instanceof Object)) throw new Error('Expected a TCP address')
    const capture = join(dir, 'prompt.txt')
    const fixture = join(dir, 'fixture.ts')
    const first = join(dir, 'first.md')
    const second = join(dir, 'second.md')
    await writeFile(first, '---\nname: first\ndescription: First skill\n---\nFirst instructions\n')
    await writeFile(
      second,
      '---\nname: second\ndescription: Second skill\n---\nSecond instructions\n',
    )
    await writeFile(
      fixture,
      `import { writeFileSync } from 'node:fs';
export default function(pi) {
  pi.registerProvider('inline-test', {
    api: 'openai-completions', apiKey: 'local-test', baseUrl: 'http://127.0.0.1:${address.port}/v1',
    models: [{ id: 'local', name: 'local', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]
  });
  pi.on('resources_discover', () => ({ skillPaths: [${JSON.stringify(second)}] }));
  pi.on('before_agent_start', (event) => { writeFileSync(${JSON.stringify(capture)}, event.prompt); });
}`,
    )
    const cli = fileURLToPath(
      new URL('./cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')),
    )
    const extension = fileURLToPath(new URL('../src/index.ts', import.meta.url))
    const args = [
      cli,
      '--offline',
      '--no-session',
      '--no-extensions',
      '--no-skills',
      '--no-context-files',
      '--no-prompt-templates',
      '--no-themes',
      '--no-tools',
      '--provider',
      'inline-test',
      '--model',
      'local',
      '--skill',
      first,
      '-e',
      extension,
      '-e',
      fixture,
      '-p',
    ]
    const options = { cwd: dir, env: { ...process.env, PI_CODING_AGENT_DIR: dir }, timeout: 20000 }
    const firstRun = exec(process.execPath, [...args, 'Use $first now'], options)
    firstRun.child.stdin?.end()
    await firstRun
    const single = await readFile(capture, 'utf8')
    expect(single).toContain(`<skill name="first" location="${first}">`)
    expect(single).toContain('First instructions')
    expect(single).toContain('Use first now')
    expect(single).not.toContain('/skill:')
    const secondRun = exec(process.execPath, [...args, 'Use $first and $second'], options)
    secondRun.child.stdin?.end()
    await secondRun
    const multiple = await readFile(capture, 'utf8')
    expect(multiple).toContain('First instructions')
    expect(multiple).toContain('Second instructions')
    expect(multiple).toContain('Use first and second')
    expect(multiple.match(/<skill name=/g)).toHaveLength(2)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  }
}, 45000)
