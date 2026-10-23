import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
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

function writeWatchGh(root, responses) {
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(root, 'responses.json'), JSON.stringify(responses))
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/usr/bin/env node',
      "const { appendFileSync, readFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "const root = join(__dirname, '..')",
      "const responses = JSON.parse(readFileSync(join(root, 'responses.json'), 'utf8'))",
      'const args = process.argv.slice(2)',
      'const field = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)',
      "const query = field('query') ?? ''",
      "appendFileSync(join(root, 'calls.log'), `${args[0]} ${args[1]} ${query.includes('ReviewThreads') ? `threads:${field('after') ?? '-'}` : ''}\\n`)",
      'const reply = (key) => process.stdout.write(JSON.stringify(responses[key]))',
      "if (args[0] === 'pr' && args[1] === 'checks') reply('checks')",
      "else if (args[0] === 'pr' && args[1] === 'view') reply('facts')",
      "else if (query.includes('ReviewThreads')) reply(field('after') === 'page-2' ? 'secondThreads' : 'firstThreads')",
      "else if (query.includes('PrCommitStatuses')) reply('commits')",
      'else process.exit(2)',
      '',
    ].join('\n'),
  )
  chmodSync(join(bin, 'gh'), 0o755)
  return bin
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
      'scripts/worktree-audit.sh',
      'scripts/release-worktree.sh',
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
      'skills/pr/SKILL.md',
      'skills/pr/references/screenshots.md',
      'skills/reflect/SKILL.md',
      'skills/swarm/SKILL.md',
    ])
      expect(() => readFileSync(join(packageRoot, path))).not.toThrow()
  })

  it('keeps upstream manual skills hidden from automatic model invocation', () => {
    for (const name of [
      'how',
      'create-formal-verification-skill',
      'in-your-own-words',
      'ketchup',
      'maintain-formal-verification-skill',
      'sharpen',
      'statechart',
      'typescript-best-practices',
      'unslop',
      'why',
    ]) {
      expect(text(join(packageRoot, 'skills', name, 'SKILL.md'))).toContain(
        'disable-model-invocation: true',
      )
    }
  })

  it('uses available Pi contracts and exact model selectors', () => {
    const skill = text(join(skillRoot, 'SKILL.md'))
    expect(skill).toContain('name: poteto-mode')
    expect(skill).toContain('Use `subagent_type: "poteto-agent"`')
    expect(skill).toContain('capability_profile: "pstack-nested"')
    const orchestrate = text(join(skillRoot, 'playbooks', 'orchestrate.md'))
    expect(orchestrate).toContain('Use `subagent_type: "poteto-agent"`')
    expect(orchestrate).toContain(
      'Give `capability_profile: "pstack-nested"` only to owners that must delegate.',
    )
    expect(orchestrate).toContain('Record `poteto-agent` and `pstack-nested` rules exactly.')
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
    expect(backends).toContain('The `auto` default prefers GitHub')
    expect(backends).toContain('--no-stack')
    expect(backends).toContain('Never pass a numeric target.')
    expect(backends).toContain('Never install an extension without approval.')
    const shipping = text(join(skillRoot, 'playbooks', 'shipping.md'))
    expect(shipping).toContain('Merge only a fully verified GitHub stack')
    expect(shipping).toContain('git patch-id --stable')
    expect(shipping).toContain('--queued-stack --stack-prs <bottom-to-top-prs>')
    expect(shipping).not.toMatch(/gh stack merge [^\n]*<[^\n]*>/)
    const opening = text(join(skillRoot, 'playbooks', 'opening-a-pr.md'))
    expect(opening).toContain('gh pr create --attach <file>')
    expect(opening).toContain('gh pr edit <number> --attach <file>')
    expect(opening).toContain('gh stack submit` does not accept `--attach')
    expect(opening).toContain('partial success')
    expect(opening).toContain('Load the bundled `pr` skill from `../pr/SKILL.md`')
    expect(opening).not.toContain('~/.agents/skills/pr')
    expect(opening).toContain('Their prompt requires the `pr` skill for the PR body.')
    expect(opening).not.toContain('`## What changed`')
    const plan = text(join(skillRoot, 'playbooks', 'multi-phase-plan.md'))
    expect(plan).toContain('Lane 1. Regression lane against trunk')
    expect(plan).toContain('If not, use absolute measurements and limits.')
    const babysit = text(join(skillRoot, 'playbooks', 'babysit.md'))
    expect(babysit).toContain('gh api --input')
    const typeScript = text(join(packageRoot, 'skills', 'typescript-best-practices', 'SKILL.md'))
    expect(typeScript).toContain('Schemas before guards')
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

  it('respects fenced code blocks in plan checks', () => {
    const playbook = text(join(skillRoot, 'playbooks', 'multi-phase-plan.md'))
    const plan = playbook.split('````markdown\n')[1].split('\n````')[0]
    const path = join(tmpdir(), `poteto-plan-fence-${process.pid}.md`)
    const check = (example) => {
      writeFileSync(path, `${plan}\n\n${example}`)
      return run('node', [join(skillRoot, 'scripts', 'check-plan.mjs'), path])
    }
    const appendix = '"## Example only" after Close the program is not an appendix'
    try {
      for (const example of [
        ...['', ' ', '  ', '   '].map(
          (indent) => `${indent}\`\`\`markdown\n## Example only\n${indent}\`\`\`\n`,
        ),
        '```markdown\n## Example only\n````\n',
        '````markdown\n```markdown\n## Example only\n```\n````\n',
        '~~~markdown `info`\n## Example only\n ~~~\n',
        '````markdown\n~~~\n## Example only\n````\n',
        '````markdown\n```\n## Example only\n````\n',
        '````markdown\n``` info\n## Example only\n````\n',
      ]) {
        const accepted = check(example)
        expect({ example, stderr: accepted.stderr, status: accepted.status }).toEqual({
          example,
          stderr: '',
          status: 0,
        })
      }
      for (const suffix of ['  ', '\t']) {
        const heading = check(`\`\`\`markdown\n## Example only\n\`\`\`${suffix}\n## Example only\n`)
        expect(heading.status).toBe(1)
        expect(heading.stderr).toContain(appendix)
      }
      const backtickInfo = check('```markdown `invalid`\n## Example only\n```\n')
      expect(backtickInfo.status).toBe(1)
      expect(backtickInfo.stderr).toContain(appendix)
      const prose = check(
        '```markdown\nThis prose has a mid-sentence colon: inside code\n```\nThis prose has a mid-sentence colon: bad.\n',
      )
      expect(prose.status).toBe(1)
      expect(prose.stderr.match(/mid-sentence colon/g)).toHaveLength(1)
    } finally {
      rmSync(path, { force: true })
    }
  })

  it('rejects a plan that does not arm the hourly audit loop', () => {
    const playbook = text(join(skillRoot, 'playbooks', 'multi-phase-plan.md'))
    const plan = playbook
      .split('````markdown\n')[1]
      .split('\n````')[0]
      .replace('`/loop 1h`', '`/loop 30m`')
    const path = join(tmpdir(), `poteto-plan-loop-${process.pid}.md`)
    writeFileSync(path, plan)
    const result = run('node', [join(skillRoot, 'scripts', 'check-plan.mjs'), path])
    rmSync(path, { force: true })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Program checklist lacks "/loop 1h"')
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

  it('resolves the orchestration frontier from the pull request base chain', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'poteto-frontier-')))
    const repo = join(root, 'repo')
    const bin = join(root, 'bin')
    const store = join(root, 'store')
    const git = (args) => run('git', args, { cwd: repo })
    try {
      mkdirSync(repo)
      mkdirSync(bin)
      expect(git(['init', '--quiet', '--initial-branch=main']).status).toBe(0)
      expect(git(['config', 'user.name', 'Poteto Test']).status).toBe(0)
      expect(git(['config', 'user.email', 'poteto@example.com']).status).toBe(0)
      writeFileSync(join(repo, 'main.txt'), 'main\n')
      expect(git(['add', '.']).status).toBe(0)
      expect(git(['commit', '--quiet', '-m', 'main']).status).toBe(0)
      const sha = {}
      for (const branch of ['stack/one', 'stack/two', 'stack/three']) {
        expect(git(['checkout', '--quiet', '-b', branch]).status).toBe(0)
        writeFileSync(join(repo, `${branch.slice(6)}.txt`), `${branch}\n`)
        expect(git(['add', '.']).status).toBe(0)
        expect(git(['commit', '--quiet', '-m', branch]).status).toBe(0)
        sha[branch] = git(['rev-parse', 'HEAD']).stdout.trim()
      }
      expect(git(['checkout', '--quiet', 'stack/two']).status).toBe(0)
      const row = (number, state, head, base) => ({
        baseRefName: base,
        headRefName: head,
        number,
        state,
      })
      const list = (filter, branch) =>
        `pr list ${filter} ${branch} --state all --json number,state,headRefName,baseRefName`
      const reply = (rows) => `printf '%s\\n' '${JSON.stringify(rows)}'`
      writeFileSync(
        join(bin, 'gh'),
        `#!/usr/bin/env bash
set -euo pipefail
[ "$(pwd -P)" = "${repo}" ] || exit 8
case "$*" in
  "${list('--head', 'stack/two')}") ${reply([row(11, 'OPEN', 'stack/two', 'stack/one')])} ;;
  "${list('--head', 'stack/one')}") ${reply([row(10, 'MERGED', 'stack/one', 'main')])} ;;
  "${list('--base', 'stack/two')}") ${reply([row(12, 'OPEN', 'stack/three', 'stack/two'), row(13, 'CLOSED', 'stack/old', 'stack/two')])} ;;
  "${list('--base', 'stack/three')}") ${reply([])} ;;
  *) printf 'unexpected gh arguments: %s\\n' "$*" >&2; exit 2 ;;
esac
`,
      )
      chmodSync(join(bin, 'gh'), 0o755)
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
      const orch = join(skillRoot, 'scripts', 'orch', 'orch')
      expect(run(orch, ['--store', store, 'init'], { env }).status).toBe(0)
      const result = run(orch, ['--store', store, 'frontier', 'set', '--repo', repo], { env })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(JSON.parse(readFileSync(join(store, 'frontier.json'), 'utf8'))).toEqual({
        generation: 1,
        lowestUnmerged: 11,
        prs: [
          { branches: 'stack/one', pr: 10, sha: sha['stack/one'], state: 'MERGED' },
          { branches: 'stack/two', pr: 11, sha: sha['stack/two'], state: 'OPEN' },
          { branches: 'stack/three', pr: 12, sha: sha['stack/three'], state: 'OPEN' },
        ],
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('names the branch that has no pull request in the frontier chain', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'poteto-frontier-missing-')))
    const repo = join(root, 'repo')
    const bin = join(root, 'bin')
    const store = join(root, 'store')
    const git = (args) => run('git', args, { cwd: repo })
    try {
      mkdirSync(repo)
      mkdirSync(bin)
      expect(git(['init', '--quiet', '--initial-branch=main']).status).toBe(0)
      expect(git(['config', 'user.name', 'Poteto Test']).status).toBe(0)
      expect(git(['config', 'user.email', 'poteto@example.com']).status).toBe(0)
      writeFileSync(join(repo, 'main.txt'), 'main\n')
      expect(git(['add', '.']).status).toBe(0)
      expect(git(['commit', '--quiet', '-m', 'main']).status).toBe(0)
      expect(git(['checkout', '--quiet', '-b', 'stack/one']).status).toBe(0)
      writeFileSync(join(bin, 'gh'), "#!/usr/bin/env bash\nprintf '[]\\n'\n")
      chmodSync(join(bin, 'gh'), 0o755)
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
      const orch = join(skillRoot, 'scripts', 'orch', 'orch')
      expect(run(orch, ['--store', store, 'init'], { env }).status).toBe(0)
      const result = run(orch, ['--store', store, 'frontier', 'set', '--repo', repo], { env })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'branch stack/one has no pull request; open one with gh pr create',
      )
      expect(readFileSync(join(store, 'frontier.json'), 'utf8')).toBe('{}\n')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('releases only a published clean destination worktree', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'poteto-release-')))
    const release = join(skillRoot, 'scripts', 'release-worktree.sh')
    const repo = join(root, 'repo')
    const lane = join(root, 'lane')
    const git = (args, cwd = repo) => run('git', args, { cwd })
    try {
      expect(run('git', ['init', '--quiet', '--bare', join(root, 'remote.git')]).status).toBe(0)
      expect(run('git', ['clone', '--quiet', join(root, 'remote.git'), repo]).status).toBe(0)
      expect(git(['config', 'user.name', 'Poteto Test']).status).toBe(0)
      expect(git(['config', 'user.email', 'poteto@example.com']).status).toBe(0)
      writeFileSync(join(repo, '.gitignore'), 'node_modules/\n')
      writeFileSync(join(repo, 'main.txt'), 'main\n')
      expect(git(['add', '.']).status).toBe(0)
      expect(git(['commit', '--quiet', '-m', 'main']).status).toBe(0)
      expect(git(['push', '--quiet', 'origin', 'HEAD:main']).status).toBe(0)
      expect(git(['worktree', 'add', '--quiet', '-b', 'stack/one', lane]).status).toBe(0)
      writeFileSync(join(lane, 'one.txt'), 'one\n')
      expect(git(['add', 'one.txt'], lane).status).toBe(0)
      expect(git(['commit', '--quiet', '-m', 'one'], lane).status).toBe(0)
      mkdirSync(join(lane, 'node_modules'))
      writeFileSync(join(lane, 'node_modules', 'large.bin'), 'dependency\n')

      const unpublished = run('bash', [release, lane])
      expect(unpublished.status).toBe(1)
      expect(unpublished.stdout).toBe(
        `held\t${lane}\tremote branch origin/stack/one is unavailable\n`,
      )

      expect(git(['push', '--quiet', 'origin', 'stack/one'], lane).status).toBe(0)
      writeFileSync(join(lane, 'one.txt'), 'local edit\n')
      const dirty = run('bash', [release, lane])
      expect(dirty.status).toBe(1)
      expect(dirty.stdout).toBe(`held\t${lane}\tuncommitted or untracked changes\n`)
      expect(git(['checkout', '--quiet', '--', 'one.txt'], lane).status).toBe(0)

      writeFileSync(join(lane, 'two.txt'), 'two\n')
      expect(git(['add', 'two.txt'], lane).status).toBe(0)
      expect(git(['commit', '--quiet', '-m', 'two'], lane).status).toBe(0)
      const ahead = run('bash', [release, lane])
      expect(ahead.status).toBe(1)
      expect(ahead.stdout).toBe(`held\t${lane}\tHEAD is not on origin/stack/one\n`)
      expect(git(['push', '--quiet', 'origin', 'stack/one'], lane).status).toBe(0)

      const main = run('bash', [release, repo])
      expect(main.status).toBe(1)
      expect(main.stdout).toBe(`held\t${repo}\tmain worktree\n`)

      const released = run('bash', [release, lane])
      expect(released.stderr).toBe('')
      expect(released.status).toBe(0)
      expect(released.stdout).toMatch(
        new RegExp(`^released\\t${lane}\\tstack/one\\torigin/stack/one\\t\\d+\\n$`),
      )
      expect(() => readdirSync(lane)).toThrow(/ENOENT/)
      expect(git(['branch', '--list', 'stack/one']).stdout).toBe('')
      expect(git(['worktree', 'list', '--porcelain']).stdout).not.toContain(lane)
      expect(git(['ls-remote', 'origin', 'refs/heads/stack/one']).stdout).not.toBe('')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('audits merged worktrees against the remote default branch or an explicit base', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'poteto-audit-')))
    const repo = join(root, 'repo')
    const lane = join(root, 'lane')
    const bin = join(root, 'bin')
    const git = (args, cwd = repo) => run('git', args, { cwd })
    try {
      mkdirSync(bin)
      writeFileSync(join(bin, 'gh'), '#!/usr/bin/env bash\nexit 1\n')
      chmodSync(join(bin, 'gh'), 0o755)
      expect(run('git', ['init', '--quiet', '--bare', join(root, 'remote.git')]).status).toBe(0)
      expect(run('git', ['clone', '--quiet', join(root, 'remote.git'), repo]).status).toBe(0)
      expect(git(['config', 'user.name', 'Poteto Test']).status).toBe(0)
      expect(git(['config', 'user.email', 'poteto@example.com']).status).toBe(0)
      writeFileSync(join(repo, 'integration.txt'), 'integration\n')
      expect(git(['add', '.']).status).toBe(0)
      expect(git(['commit', '--quiet', '-m', 'integration']).status).toBe(0)
      expect(git(['push', '--quiet', 'origin', 'HEAD:integration']).status).toBe(0)
      writeFileSync(join(repo, 'next.txt'), 'next\n')
      expect(git(['add', '.']).status).toBe(0)
      expect(git(['commit', '--quiet', '-m', 'next']).status).toBe(0)
      expect(git(['push', '--quiet', 'origin', 'HEAD:next']).status).toBe(0)
      expect(git(['remote', 'set-head', 'origin', 'next']).status).toBe(0)
      expect(git(['update-ref', '-d', 'refs/remotes/origin/integration']).status).toBe(0)
      expect(git(['worktree', 'add', '--quiet', '--detach', lane, 'origin/next']).status).toBe(0)
      const audit = (...args) =>
        run('bash', [join(skillRoot, 'scripts', 'worktree-audit.sh'), ...args, repo], {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
        })
      const laneRow = (stdout) =>
        stdout
          .split('\n')
          .find((line) => line.endsWith(`\t${lane}`))
          ?.split('\t')
          .slice(2, 7)

      const remoteDefault = audit()
      expect(remoteDefault.stderr).toBe('warn: no -b given; MERGED checks against origin/next\n')
      expect(remoteDefault.status).toBe(0)
      expect(remoteDefault.stdout.split('\n')[0]).toBe('# base: origin/next')
      expect(laneRow(remoteDefault.stdout)).toEqual(['YES', 'clean', 'detached', '-', 'safe'])

      const prBase = audit('-b', 'origin/integration')
      expect(prBase.stderr).toBe('')
      expect(prBase.status).toBe(0)
      expect(prBase.stdout.split('\n')[0]).toBe('# base: origin/integration')
      expect(laneRow(prBase.stdout)).toEqual(['no', 'clean', 'detached', '-', 'review'])

      const missing = audit('--base', 'origin/missing')
      expect(missing.status).toBe(1)
      expect(missing.stdout).toBe('')
      expect(missing.stderr).toContain('error: base ref not found: origin/missing')

      const option = audit('--unknown')
      expect(option.status).toBe(2)
      expect(option.stderr).toBe('error: unknown option: --unknown\n')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('loads the bundled CLIs and parses the audit script', () => {
    const orch = run(join(skillRoot, 'scripts', 'orch', 'orch'), ['--help'])
    const watcher = run(join(skillRoot, 'scripts', 'watch-pr', 'watch-pr'), ['--help'])
    const audit = run('bash', ['-n', join(skillRoot, 'scripts', 'worktree-audit.sh')])
    const release = run('bash', [join(skillRoot, 'scripts', 'release-worktree.sh')])
    expect(release.status).toBe(2)
    expect(release.stderr).toContain('usage: release-worktree.sh <worktree>')
    expect(orch.status).toBe(0)
    expect(orch.stdout).toContain('Plain-file orchestrate bookkeeping')
    expect(watcher.status).toBe(0)
    expect(watcher.stdout).toContain('Watch one pull request')
    expect(audit.status).toBe(0)
  })

  it('reads review threads beyond the first page through the bundled watcher', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'poteto-watch-')))
    const thread = (id, resolved) => ({
      id,
      isResolved: resolved,
      comments: {
        nodes: [
          {
            author: { login: 'reviewer' },
            body: `${id} body`,
            createdAt: '2026-01-01T00:00:00Z',
            line: 1,
            path: 'a.ts',
          },
        ],
      },
    })
    const page = (nodes, endCursor) => ({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes, pageInfo: { endCursor, hasNextPage: endCursor !== null } },
          },
        },
      },
    })
    const responses = {
      checks: [
        { bucket: 'pass', description: '', link: '', name: 'ci', state: 'SUCCESS', workflow: 'ci' },
      ],
      commits: { data: { repository: { pullRequest: { commits: { nodes: [] } } } } },
      facts: {
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        mergeable: 'MERGEABLE',
        mergedAt: null,
        reviewDecision: 'APPROVED',
        state: 'OPEN',
      },
      firstThreads: page([thread('early', true)], 'page-2'),
      secondThreads: page([thread('late', false)], null),
    }
    try {
      const bin = writeWatchGh(root, responses)
      const result = run(
        join(skillRoot, 'scripts', 'watch-pr', 'watch-pr'),
        ['--owner', 'o', '--repo', 'r', '--pr', '7', '--status-only'],
        { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` } },
      )
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const report = JSON.parse(result.stdout)
      expect(report.kind).toBe('STATUS')
      expect(report.rows.map((row) => row.threads.map((entry) => entry.id))).toEqual([['late']])
      expect(
        readFileSync(join(root, 'calls.log'), 'utf8')
          .split('\n')
          .filter((line) => line.includes('threads:')),
      ).toEqual(['api graphql threads:-', 'api graphql threads:page-2'])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('waits on a Code Review Gate that needs owner approval instead of failing it', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'poteto-watch-gate-')))
    const emptyThreads = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
          },
        },
      },
    }
    const check = (name, state, bucket) => ({
      bucket,
      description: '',
      link: '',
      name,
      state,
      workflow: '',
    })
    const responses = {
      checks: [
        check('ci', 'SUCCESS', 'pass'),
        check('Code Review Gate', 'ACTION_REQUIRED', 'fail'),
      ],
      commits: { data: { repository: { pullRequest: { commits: { nodes: [] } } } } },
      facts: {
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc',
        isDraft: false,
        mergeStateStatus: 'BLOCKED',
        mergeable: 'MERGEABLE',
        mergedAt: null,
        reviewDecision: 'REVIEW_REQUIRED',
        state: 'OPEN',
      },
      firstThreads: emptyThreads,
    }
    try {
      const bin = writeWatchGh(root, responses)
      const result = run(
        join(skillRoot, 'scripts', 'watch-pr', 'watch-pr'),
        ['--owner', 'o', '--repo', 'r', '--pr', '7', '--pretty'],
        { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` } },
      )
      expect(result.stderr).toBe('')
      expect(result.stdout).toMatch(/^READY: /)
      expect(result.status).toBe(0)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
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
