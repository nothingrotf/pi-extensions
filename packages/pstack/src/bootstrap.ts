import { readdir, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function loadPstackBootstrap(): Promise<{ root: string; systemPrompt: string }> {
  const root = await realpath(fileURLToPath(new URL('../skills/', import.meta.url)))
  const directories = await readdir(root, { withFileTypes: true })
  const pointers = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => relative(root, await realpath(join(root, entry.name, 'SKILL.md')))),
  )
  return {
    root,
    systemPrompt: [
      '# Canonical pstack bootstrap',
      `The active pstack skill base path is ${root}.`,
      'Resolve every skill pointer below against that canonical base, never the workspace. Do not search home directories, Trash, or other checkouts for alternate copies.',
      'Read each required SKILL.md in full before applying it. Resolve its relative links and scripts against the directory containing that SKILL.md, not the workspace.',
      'Your todo_read and todo_write state belongs only to this child session. Track your assigned scope, not the parent or sibling plans. Read-only planning never authorizes file writes.',
      'Use request_parent for scope, permission, product, and preference decisions from the real coordinator. ask_parent is advisory only and cannot authorize changes. If request_parent is unavailable, times out, or rejects the request, stop the affected work and report the unresolved decision. Never substitute advisory guidance for authorization.',
      'Task delegation requires an explicitly enabled nested profile and stays within its depth bound. A leaf must return required delegation to its coordinator, not simulate missing tools or silently skip mandatory skill steps.',
      'An accepted design carries its grounding. Run how and why in the current owner by default. Keep reproduction, investigation, implementation, and corrections together. Return genuinely new or contested design to the coordinator.',
      'Use Task.delivery for the managed or independent delivery binding. Prompt-only fields phase, accepted design, evidence, base, head, patch, verification owner, and acceptance criteria remain in the Task prompt, never in the Task schema. Read `poteto-mode/references/delivery-contract.md` for the shared vocabulary. Publication stays separately scoped and foreground.',
      ...pointers,
    ].join('\n'),
  }
}
