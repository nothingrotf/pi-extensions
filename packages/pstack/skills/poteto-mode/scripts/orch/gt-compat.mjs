#!/usr/bin/env bun

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

const StackView = Type.Object({
  trunk: Type.String({ minLength: 1 }),
  branches: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      pr: Type.Optional(
        Type.Object({
          number: Type.Integer({ minimum: 1 }),
          state: Type.Union([
            Type.Literal('OPEN'),
            Type.Literal('MERGED'),
            Type.Literal('CLOSED'),
            Type.Literal('QUEUED'),
          ]),
        }),
      ),
    }),
  ),
})

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function stackView() {
  let raw
  const snapshot = process.env.POTETO_GH_STACK_SNAPSHOT
  if (snapshot === undefined) {
    const result = spawnSync('gh', ['stack', 'view', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
    })
    if (result.status !== 0) {
      fail(result.stderr.trim() || 'gh stack view --json failed')
    }
    raw = result.stdout
  } else {
    try {
      raw = readFileSync(snapshot, 'utf8')
    } catch {
      fail(`cannot read GitHub stack snapshot ${snapshot}`)
    }
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    fail('gh stack view --json returned invalid JSON')
  }
  if (!Value.Check(StackView, value)) {
    fail('gh stack view --json returned an invalid stack')
  }
  return value
}

const args = process.argv.slice(2)
const view = stackView()

if (args.join(' ') === '--no-interactive log short --stack --reverse') {
  process.stdout.write(`◯ ${view.trunk}\n`)
  for (const branch of view.branches) {
    process.stdout.write(`◯ ${branch.name}\n`)
  }
  process.exit(0)
}

if (args.length === 3 && args[0] === '--no-interactive' && args[1] === 'info') {
  const name = args[2]
  const branch = view.branches.find((candidate) => candidate.name === name)
  if (branch === undefined) {
    fail(`gh stack view --json omitted branch ${name}`)
  }
  if (branch.pr === undefined) {
    fail(`gh stack branch ${name} has no pull request`)
  }
  const status = {
    OPEN: 'Needs approvals',
    MERGED: 'Merged',
    CLOSED: 'Closed',
    QUEUED: 'Queued to merge...',
  }[branch.pr.state]
  process.stdout.write(`${name}\nPR #${branch.pr.number} (${status}) GitHub stack\n`)
  process.exit(0)
}

fail(`unsupported gt compatibility arguments: ${args.join(' ')}`)
