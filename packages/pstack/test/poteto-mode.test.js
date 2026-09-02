import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills', 'poteto-mode')

function text(path) {
  return readFileSync(path, 'utf8')
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: packageRoot, encoding: 'utf8', ...options })
}

describe('poteto-mode', () => {
  it('ships complete investigation playbooks', () => {
    for (const path of [
      'playbooks/investigation.md',
      'playbooks/prototype.md',
      'playbooks/runtime-forensics.md',
      'playbooks/trace-forensics.md',
    ])
      expect(text(join(skillRoot, path)).length).toBeGreaterThan(500)
  })

  it('ships every playbook and the retained runtime scripts', () => {
    expect(
      readdirSync(join(skillRoot, 'playbooks')).filter((name) => name.endsWith('.md')),
    ).toHaveLength(23)
    for (const path of [
      'scripts/check-plan.mjs',
      'scripts/orch/orch',
      'scripts/orch/orch.bundle',
      'scripts/orch/gt-compat.mjs',
      'scripts/worktree-audit.sh',
      'scripts/watch-pr/watch-pr',
      'scripts/watch-pr/watch-pr.bundle',
    ])
      expect(() => readFileSync(join(skillRoot, path))).not.toThrow()
  })

  it('ships every restored Poteto dependency', () => {
    for (const path of [
      'agents/poteto-agent.md',
      'skills/control-cli/SKILL.md',
      'skills/control-ui/SKILL.md',
      'skills/create-skill/SKILL.md',
      'skills/deslop/SKILL.md',
      'skills/figure-it-out/SKILL.md',
      'skills/reflect/SKILL.md',
      'skills/swarm/SKILL.md',
    ])
      expect(() => readFileSync(join(packageRoot, path))).not.toThrow()
  })

  it('uses available Pi contracts and exact model selectors', () => {
    const skill = text(join(skillRoot, 'SKILL.md'))
    expect(skill).toContain('name: poteto-mode')
    expect(skill).toContain('Use `subagent_type: "poteto-agent"`')
    expect(skill).toContain('capability_profile: "pstack-nested"')
    expect(skill).toContain('`TaskControl`')
    expect(skill).toContain('`AskQuestion`')
    expect(skill).toContain('**create-skill**')
    expect(skill).toContain('**deslop**')
    expect(skill).toContain('**control-cli**')
    expect(skill).toContain('**control-ui**')
    expect(skill).toContain('provider/model-id:effort [fast]')
    expect(skill).toContain('Omit `Task.model`')
    expect(skill).toContain('with `todo_write`')
    expect(skill).toContain('gt or github/gh-stack')
    expect(skill).not.toMatch(/Cursor|grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5|todolist/)
    const backends = text(join(skillRoot, 'references', 'stack-backends.md'))
    expect(backends).toContain('ask whether to install `github/gh-stack` with `AskQuestion`')
    expect(backends).toContain('gh stack submit --auto --open')
    expect(backends).toContain('gh stack merge --yes')
    expect(backends).toContain('Never pass a numeric target.')
    expect(backends).toContain('Never install an extension without approval.')
    const shipping = text(join(skillRoot, 'playbooks', 'shipping.md'))
    expect(shipping).toContain('require a passing verdict through the top PR')
    expect(shipping).not.toMatch(/gh stack merge [^\n]*<[^\n]*>/)
  })

  it('validates the bundled plan template', () => {
    const playbook = text(join(skillRoot, 'playbooks', 'multi-phase-plan.md'))
    const plan = playbook.split('````markdown\n')[1].split('\n````')[0]
    const path = join(tmpdir(), `poteto-plan-${process.pid}.md`)
    writeFileSync(path, plan)
    const result = run('node', [join(skillRoot, 'scripts', 'check-plan.mjs'), path])
    rmSync(path, { force: true })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('1 PR sections, 0 problems')
  })

  it('runs the orchestration store through the bundled CLI', () => {
    const orch = join(skillRoot, 'scripts', 'orch', 'orch')
    const store = join(tmpdir(), `poteto-orch-${process.pid}`)
    rmSync(store, { force: true, recursive: true })
    expect(run(orch, ['--store', store, 'init']).status).toBe(0)
    expect(run(orch, ['--store', store, 'unit', 'add', 'u1', '--track', 'build']).status).toBe(0)
    expect(
      run(orch, [
        '--store',
        store,
        'ledger',
        'record',
        '1',
        'abc123',
        'unit-test-verified',
        '--evidence',
        'tests.log',
      ]).status,
    ).toBe(0)
    expect(run(orch, ['--store', store, 'inbox', 'push', 'worker', 'u1', 'done']).status).toBe(0)
    expect(run(orch, ['--store', store, 'inbox', 'drain']).stdout).toContain('u1\tdone')
    expect(run(orch, ['--store', store, 'status']).stdout).toContain('unit-test-verified=1')
    rmSync(store, { force: true, recursive: true })
  })

  it('resolves a GitHub stack through the orchestration frontier', () => {
    const root = join(tmpdir(), `poteto-github-stack-${process.pid}`)
    const repo = join(root, 'repo')
    const bin = join(root, 'bin')
    const store = join(root, 'store')
    rmSync(root, { force: true, recursive: true })
    mkdirSync(repo, { recursive: true })
    mkdirSync(bin)
    const git = (args) => run('git', args, { cwd: repo })
    expect(git(['init', '--initial-branch=main']).status).toBe(0)
    expect(git(['config', 'user.name', 'Poteto Test']).status).toBe(0)
    expect(git(['config', 'user.email', 'poteto@example.com']).status).toBe(0)
    writeFileSync(join(repo, 'main.txt'), 'main\n')
    expect(git(['add', '.']).status).toBe(0)
    expect(git(['commit', '-m', 'main']).status).toBe(0)
    expect(git(['checkout', '-b', 'stack/one']).status).toBe(0)
    writeFileSync(join(repo, 'one.txt'), 'one\n')
    expect(git(['add', '.']).status).toBe(0)
    expect(git(['commit', '-m', 'one']).status).toBe(0)
    expect(git(['checkout', '-b', 'stack/two']).status).toBe(0)
    writeFileSync(join(repo, 'two.txt'), 'two\n')
    expect(git(['add', '.']).status).toBe(0)
    expect(git(['commit', '-m', 'two']).status).toBe(0)
    const gh = join(bin, 'gh')
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "stack --version") printf '%s\\n' 'gh stack version 0.1.0' ;;
  "stack view --json")
    [ "$(pwd -P)" = "${realpathSync(repo)}" ] || exit 8
    printf '%s\\n' '{"trunk":"main","currentBranch":"stack/two","branches":[{"name":"stack/one","pr":{"number":10,"state":"MERGED"}},{"name":"stack/two","pr":{"number":11,"state":"QUEUED"}}]}'
    ;;
  *) exit 2 ;;
esac
`,
    )
    chmodSync(gh, 0o755)
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      POTETO_STACK_BACKEND: 'github',
    }
    const orch = join(skillRoot, 'scripts', 'orch', 'orch')
    expect(run(orch, ['--store', store, 'init'], { env }).status).toBe(0)
    const result = run(orch, ['--store', store, 'frontier', 'set', '--repo', repo], { env })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(join(store, 'frontier.json'), 'utf8'))).toMatchObject({
      generation: 1,
      lowestUnmerged: 11,
      prs: [
        { branches: 'stack/one', pr: 10, state: 'MERGED' },
        { branches: 'stack/two', pr: 11, state: 'OPEN' },
      ],
    })
    rmSync(root, { force: true, recursive: true })
  })

  it('rejects a GitHub stack branch without a pull request', () => {
    const root = join(tmpdir(), `poteto-stack-without-pr-${process.pid}`)
    mkdirSync(root, { recursive: true })
    const snapshot = join(root, 'stack.json')
    writeFileSync(
      snapshot,
      JSON.stringify({
        branches: [{ name: 'stack/one' }],
        currentBranch: 'stack/one',
        trunk: 'main',
      }),
    )
    const result = run(
      join(skillRoot, 'scripts', 'orch', 'gt-compat.mjs'),
      ['--no-interactive', 'info', 'stack/one'],
      { env: { ...process.env, POTETO_GH_STACK_SNAPSHOT: snapshot } },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('gh stack branch stack/one has no pull request')
    rmSync(root, { force: true, recursive: true })
  })

  it('requires approval before the GitHub stack extension installation path', () => {
    const root = join(tmpdir(), `poteto-missing-stack-${process.pid}`)
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    const gh = join(bin, 'gh')
    const calls = join(root, 'calls.txt')
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"${calls}"
exit 1
`,
    )
    chmodSync(gh, 0o755)
    const result = run(
      join(skillRoot, 'scripts', 'orch', 'orch'),
      ['frontier', 'set', '--repo', packageRoot],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          POTETO_STACK_BACKEND: 'github',
        },
      },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'obtain approval, then run gh extension install github/gh-stack',
    )
    expect(readFileSync(calls, 'utf8')).toBe('stack --version\n')
    rmSync(root, { force: true, recursive: true })
  })

  it('does not intercept non-frontier orchestration arguments', () => {
    const root = join(tmpdir(), `poteto-orch-routing-${process.pid}`)
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    const gh = join(bin, 'gh')
    const calls = join(root, 'calls.txt')
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"${calls}"
exit 1
`,
    )
    chmodSync(gh, 0o755)
    const result = run(
      join(skillRoot, 'scripts', 'orch', 'orch'),
      ['unit', 'add', 'frontier', 'set'],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          POTETO_STACK_BACKEND: 'github',
        },
      },
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).not.toContain('no stack backend is available')
    expect(() => readFileSync(calls, 'utf8')).toThrow(/ENOENT/)
    rmSync(root, { force: true, recursive: true })
  })

  it('preserves GitHub stack availability failures', () => {
    const root = join(tmpdir(), `poteto-unavailable-stack-${process.pid}`)
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    const gh = join(bin, 'gh')
    writeFileSync(
      gh,
      '#!/usr/bin/env bash\nif [ "$*" = "stack --version" ]; then exit 0; fi\nexit 9\n',
    )
    chmodSync(gh, 0o755)
    const result = run(
      join(skillRoot, 'scripts', 'orch', 'orch'),
      ['frontier', 'set', '--repo', packageRoot],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          POTETO_STACK_BACKEND: 'github',
        },
      },
    )
    expect(result.status).toBe(9)
    rmSync(root, { force: true, recursive: true })
  })

  it('loads the bundled CLIs and parses the audit script', () => {
    const orch = run(join(skillRoot, 'scripts', 'orch', 'orch'), ['--help'])
    const watcher = run(join(skillRoot, 'scripts', 'watch-pr', 'watch-pr'), ['--help'])
    const audit = run('bash', ['-n', join(skillRoot, 'scripts', 'worktree-audit.sh')])
    expect(orch.status).toBe(0)
    expect(orch.stdout).toContain('Plain-file orchestrate bookkeeping')
    expect(watcher.status).toBe(0)
    expect(watcher.stdout).toContain('Watch one pull request')
    expect(audit.status).toBe(0)
  })

  it('omits replaced Cursor runtime files', () => {
    for (const path of [
      'scripts/bootstrap.ts',
      'scripts/bun.lock',
      'scripts/package.json',
      'scripts/orch/orch.test.ts',
      'scripts/orch/orch.ts',
      'scripts/orch/store.ts',
      'scripts/watch-pr/types.compile.ts',
      'scripts/watch-pr/cli.ts',
      'scripts/watch-pr/github.ts',
      'scripts/watch-pr/policy.ts',
      'scripts/watch-pr/render.ts',
      'scripts/watch-pr/types.ts',
    ])
      expect(() => readFileSync(join(skillRoot, path))).toThrow(/ENOENT/)
  })
})
