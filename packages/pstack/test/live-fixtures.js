import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const correct =
  'export function normalizeNames(values) {\n  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]\n}\n'

async function commit(directory, message) {
  await execute('git', ['add', '.'], { cwd: directory })
  await execute(
    'git',
    [
      '-c',
      'user.name=Local Verification',
      '-c',
      'user.email=local@example.test',
      'commit',
      '--quiet',
      '-m',
      message,
    ],
    { cwd: directory },
  )
}

export async function prepareLiveFixture(directory, scenario) {
  const id = scenario.id
  let base = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim()
  let goal
  if (id.startsWith('why-') && id !== 'why-synthesis') {
    const category = id === 'why-followup' ? 'source-control' : id.slice(4)
    const excerpts = new Map([
      [
        'tickets',
        'Fictional ticket: imported duplicate names repeat in the exported list. Request: deduplicate after trimming while retaining the first appearance. Rationale: customers arrange names before import. Sorting would discard that arrangement. This is not an authenticated issue-tracker record.',
      ],
      [
        'documents',
        'Fixture ADR: normalization must preserve input order. The export is an ordered JSON array. Stable deduplication extends the existing contract. Sorting and retaining only the last occurrence were rejected because both can change the established first-seen order.',
      ],
      [
        'chat',
        'Fictional conversation: a requester asks to remove repeated names without reordering the list. A reviewer proposes sorting. The requester rejects sorting because the supplied order encodes the intended review sequence. These are fixture statements, not messages from an external chat service.',
      ],
    ])
    let evidence = excerpts.get(category)
    if (category === 'source-control')
      evidence = (
        await execute('git', ['log', '--format=fuller', '-p', '--', 'names.js'], { cwd: directory })
      ).stdout
    if (category === 'observability' || category === 'analytics') {
      const observed = await execute('bun', ['cli.js', 'Lin', 'Ada', 'Lin', ' Ada '], {
        cwd: directory,
      })
      evidence = `Actual local command: bun cli.js Lin Ada Lin " Ada "\nObserved stdout: ${observed.stdout}\nWorkload contains four synthetic inputs and two distinct normalized names. The command preserves order but retains duplicates. This is local test evidence, not production telemetry or usage analytics.`
    }
    if (category === 'errors') {
      const command =
        'import assert from "node:assert/strict"; import {normalizeNames} from "./names.js"; assert.deepEqual(normalizeNames([" Ada ", "Ada"]), ["Ada"])'
      evidence = await execute('node', ['--input-type=module', '-e', command], {
        cwd: directory,
      }).then(
        (result) => result.stdout,
        (failure) => `Actual local assertion failed with exit ${failure.code}:\n${failure.stderr}`,
      )
    }
    if (evidence === undefined) throw new Error(`Unsupported Why category ${category}`)
    await writeFile(
      join(directory, 'category-evidence.md'),
      `# ${category} evidence\n\nThis is a category-specific local fixture. No external category service was queried.\n\n${evidence}\n`,
    )
    goal = `Assigned Why category: ${category}. Investigate only category-evidence.md for this category, using local source only as context. Read the exact source guide linked by why/references/source-playbook.md instead of inventing filenames. Distinguish direct records, inference, and gaps. Preserve accurate file-line citations and state that external collection did not run. Do not substitute a source-control investigation for tickets, documents, chat, observability, errors, or analytics.`
    if (id === 'why-followup')
      goal +=
        ' First finish one bounded investigator pass. The root must then resume that same completed agent with Task.resume and ask whether sorting would preserve the documented first-seen contract. Preserve the original agent ID, role, model, and capabilities. Audit both actual turns. Do not create a replacement investigator or report follow-up coverage without a resume call.'
  } else if (id === 'feature-leaf' || id === 'orchestrate-worker') {
    await writeFile(
      join(directory, 'scoped-design.md'),
      '# Supplied leaf design\n\nThis design is supplied by the harness. It does not claim that a prior How or Architect agent executed.\n\n- Scope: names.js and names.test.js only. cli.js keeps its current interface.\n- Keep normalizeNames(values) as the single exported normalization boundary.\n- Trim each input, remove blank strings, construct a Set from the cleaned sequence, and spread it into the returned array.\n- Preserve first occurrence and case sensitivity.\n- Add a regression covering spaced duplicates, blanks, order, and lowercase versus uppercase variants.\n- Reproduce the regression before implementation and verify the actual CLI afterward.\n- The leaf executes Feature step 4 against this supplied design. The root retains owner phases and mandatory independent review.\n',
    )
    goal =
      'Implement only the complete scoped leaf design in scoped-design.md. This is a Feature step 4 implementation probe, not assignment of the enclosing workflow ownership. Reproduce the regression, implement the supplied structure without new design exploration, and run the actual CLI. Return required independent review to the root. Do not claim upstream planning or the enclosing feature workflow completed.'
  } else if (id === 'flow-how-complex') {
    await writeFile(
      join(directory, 'stdin.js'),
      'import { normalizeNames } from "./names.js"\nlet input = ""\nfor await (const chunk of process.stdin) input += chunk\nconsole.log(JSON.stringify(normalizeNames(input.split("\\n"))))\n',
    )
    goal =
      'Explain both independent entry points: argv through cli.js and newline-delimited stdin through stdin.js. Trace the shared normalization boundary, data flow, ownership, and edge cases. Use the complex exploration and synthesis path, not the simple explainer shortcut.'
  } else if (
    id.startsWith('flow-swarm') ||
    ['swarm-partition', 'swarm-race', 'swarm-mixed'].includes(id)
  ) {
    goal =
      'Inspect the CLI without editing product files. Partition mode assigns normalization semantics, argv/IO behavior, and regression coverage to separate owners. Race mode compares independent complete analyses by concrete counterexamples, source grounding, and coverage. Mixed mode uses independent normalization analyses plus an IO owner. Choose the variant named by the case, execute in waves of at most three, and explain selection and synthesis from actual outputs.'
  } else if (id.includes('bug-')) {
    await writeFile(join(directory, 'names.js'), correct)
    await writeFile(
      join(directory, 'contract.md'),
      'Names must be trimmed, blank names removed, and duplicates removed after trimming. Preserve first appearance and case sensitivity. This contract predates the regression.\n',
    )
    await commit(directory, 'Preserve first-seen names to match import ordering requirements')
    await writeFile(
      join(directory, 'names.js'),
      'export function normalizeNames(values) {\n  return values.map((value) => value.trim()).filter(Boolean)\n}\n',
    )
    await commit(directory, 'Simplify the import path')
    goal =
      'Names now repeat after import. Reproduce the regression against contract.md and local history, establish its mechanism, and restore the documented behavior. Investigation-only owners return findings without implementing.'
  } else if (id === 'refactoring' || id.includes('bespoke')) {
    await writeFile(
      join(directory, 'batch.js'),
      'export function normalizeBatch(values) {\n  return values.map((value) => value.trim()).filter(Boolean)\n}\n',
    )
    await writeFile(
      join(directory, 'batch.test.js'),
      'import { expect, test } from "bun:test"\nimport { normalizeBatch } from "./batch.js"\ntest("preserves current duplicate behavior", () => { expect(normalizeBatch([" Ada ", "Ada", ""])).toEqual(["Ada", "Ada"]) })\n',
    )
    goal =
      'Consolidate duplicated normalization in names.js and batch.js without changing any observable behavior, including duplicate preservation. Pin both callers and verify the CLI. A design or judge role returns only its prescribed artifact.'
    if (id === 'bespoke-judge') {
      await commit(directory, 'Add the duplicate batch normalization path')
      base = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim()
      await writeFile(
        join(directory, 'batch.js'),
        'export { normalizeNames as normalizeBatch } from "./names.js"\n',
      )
      await commit(directory, 'Reuse the existing normalization boundary')
      goal =
        'Judge the completed harness-prepared local refactor between base and head in scope.md. Review its actual diff and baseline-check.json, and independently assess correctness, behavior preservation, coverage, and workflow fit. This is supplied fixture implementation, not an executed upstream agent result. Do not implement or claim missing upstream phases.'
    }
  } else if (id.includes('perf') || id.includes('hillclimb') || id.includes('forensics')) {
    await writeFile(
      join(directory, 'names.js'),
      'export function normalizeNames(values) {\n  const cleaned = values.map((value) => value.trim()).filter(Boolean)\n  return cleaned.filter((value, index) => cleaned.indexOf(value) === index)\n}\n',
    )
    await writeFile(
      join(directory, 'bench.js'),
      'import { normalizeNames } from "./names.js"\nconst input = Array.from({ length: 18000 }, (_, index) => `name-${index}`)\nconst samples = []\nfor (let run = 0; run < 5; run += 1) {\n  const start = performance.now()\n  const output = normalizeNames(input)\n  if (output.length !== input.length) throw new Error("Output changed")\n  samples.push(performance.now() - start)\n}\nsamples.sort((left, right) => left - right)\nconsole.log(JSON.stringify({ workload: input.length, samples, medianMs: samples[2] }))\n',
    )
    const measured = await execute('node', ['bench.js'], { cwd: directory })
    await writeFile(join(directory, 'baseline.json'), measured.stdout)
    await writeFile(
      join(directory, 'correctness-gate.js'),
      'import assert from "node:assert/strict"\nimport { normalizeNames } from "./names.js"\nassert.deepEqual(normalizeNames([" Lin ", "Ada", "Lin", " ", "Ada ", "ada"]), ["Lin", "Ada", "ada"])\nconsole.log("Exact normalization contract passed")\n',
    )
    await execute('node', ['correctness-gate.js'], { cwd: directory })
    if (id.includes('forensics')) {
      const capture = await execute(
        'node',
        ['--cpu-prof', '--cpu-prof-name=normalization.cpuprofile', 'bench.js'],
        { cwd: directory },
      )
      await writeFile(
        join(directory, 'capture-command.txt'),
        `node --cpu-prof --cpu-prof-name=normalization.cpuprofile bench.js\n${capture.stdout}`,
      )
      goal = id.startsWith('runtime-')
        ? 'Diagnose CPU work during large imports. The runnable workload is node bench.js. The supplied baseline and CPU capture are real local measurements. Capture fresh evidence when shell access is available. Attribute the cost to source and confirm the mechanism without implementing a fix. A read-only reader analyzes the supplied capture rather than pretending to instrument a running process.'
        : 'Diagnose the supplied normalization.cpuprofile captured from node bench.js. Correlate capture-command.txt and names.js. Attribute the dominant cost to source. Do not rerun the workload or implement a fix. If the mandated conversion tooling is absent, report that exact blocker.'
    } else {
      goal = `Optimize the measured bulk import without changing output. Use the frozen node bench.js workload and baseline.json. ${id.includes('hillclimb') ? 'Target at least a 30 percent reduction in medianMs over at least three measured hypotheses, recording kept and reverted attempts.' : 'Capture the dominant cost before the change and repeat the same measurement afterward.'} Preserve the workload and correctness check.`
    }
  } else if (id.includes('interrogate')) {
    await writeFile(
      join(directory, 'names.js'),
      'export function normalizeNames(values) {\n  return [...new Set(values)].map((value) => value.trim()).filter(Boolean)\n}\n',
    )
    await writeFile(
      join(directory, 'contract.md'),
      'Remove duplicate trimmed names, preserve first appearance, preserve case sensitivity, and remove blank names.\n',
    )
    goal =
      'Independently review the uncommitted names.js diff against contract.md. Find actionable correctness defects with concrete input and expected output. Do not edit product files.'
  } else if (id.includes('comment')) {
    goal =
      'Audit exactly names.js and cli.js directly using your assigned Comment Sicko rules. Preserve application behavior. These scoped files contain no comments, so a truthful zero-deletion result is valid. Do not manufacture comments, defects, or behavior changes to make the audit nonempty.'
  } else if (id.includes('maintenance') || id.includes('verification-source')) {
    const root = join(directory, '.pi/skills/verify-name-list')
    await mkdir(join(root, 'features'), { recursive: true })
    await writeFile(
      join(root, 'SKILL.md'),
      '---\nname: verify-name-list\ndescription: Verify the local name-list CLI through real command invocations.\ndisable-model-invocation: true\n---\n# Verify name list\n\n## Launch\nRun commands from the project root. Each command is an isolated short-lived process. No server is required.\n\n## Doctor\nRun `bun --version` and `git rev-parse --show-toplevel`.\n\n## Drive\nRun `bun cli.js " Ada " "" " Lin "` and `bun test`. Follow features/README.md for all cases.\n\n## Evidence\nSave commands, stdout, exit codes, and git diff under evidence/.\n\n## Cleanup\nThe commands exit after each drive. Preserve evidence/.\n\n## Feature map\nRead features/README.md.\n',
    )
    await writeFile(
      join(root, 'features/README.md'),
      '# Features\n\n- argv.md\n- blanks.md\n- duplicates.md\n',
    )
    for (const [name, command, output] of [
      ['argv', 'bun cli.js " Ada " " Lin "', '["Ada","Lin"]'],
      ['blanks', 'bun cli.js "" " "', '[]'],
      ['duplicates', 'bun cli.js Ada Ada', '["Ada","Ada"]'],
    ]) {
      await writeFile(
        join(root, `features/${name}.md`),
        `# ${name}\n\n## Sub-features\nNormalize command-line names.\n\n## How to get to it (user POV)\nUse the CLI from the project root.\n\n## Driving it with the shell\nRun \`${command}\`. Expected stdout: \`${output}\`.\n\n## Gotchas\nDuplicate preservation is current behavior, not deduplication.\n`,
      )
    }
    goal =
      'Audit .pi/skills/verify-name-list and its three feature files against source. Source-reader roles return one scoped recipe without edits or app control. For the maintenance workflow, run every mapped CLI route serially and preserve real evidence. Do not modify product code or publish anything.'
  } else if (id.includes('bulk')) {
    const lines = Array.from(
      { length: 1500 },
      (_, index) => `${index + 1}\t${index % 137 === 0 ? 'ERROR' : 'OK'}\tname-${index}`,
    )
    await writeFile(join(directory, 'import.log'), `${lines.join('\n')}\n`)
    goal =
      'Reduce import.log into error count, affected line numbers, and decisive evidence pointers. Keep the result bounded and do not return the raw log. Do not modify files.'
  } else if (id.includes('worktree-investigator')) {
    await execute('git', ['worktree', 'add', '--quiet', '--detach', '../clean-copy', 'HEAD'], {
      cwd: directory,
    })
    await execute('git', ['worktree', 'add', '--quiet', '--detach', '../dirty-copy', 'HEAD'], {
      cwd: directory,
    })
    await writeFile(join(directory, '../dirty-copy/local.txt'), 'Uncommitted local work\n')
    await writeFile(
      join(directory, 'worktrees.md'),
      'The harness created ../clean-copy and ../dirty-copy. Neither runs an agent. The main project runs this validation and must remain untouched. Inspect git state before classifying either sibling. Do not delete anything.\n',
    )
    goal =
      'Classify the disposable worktrees named in worktrees.md for safe reclamation. Prove cleanliness, dirty work, and active-project holds from local evidence. Remain read-only and do not inspect global caches or simulators.'
  } else if (
    id.includes('shipping') ||
    id.includes('publication') ||
    id.includes('stacker') ||
    id.startsWith('flow-autopilot') ||
    id === 'flow-multi-phase-thirteen-lanes'
  ) {
    await writeFile(join(directory, 'names.js'), correct)
    await writeFile(
      join(directory, 'dedup.test.js'),
      'import { expect, test } from "bun:test"\nimport { normalizeNames } from "./names.js"\ntest("deduplicates trimmed names stably", () => { expect(normalizeNames([" Ada ", "Lin", "Ada"])).toEqual(["Ada", "Lin"]) })\n',
    )
    await commit(directory, 'Deduplicate trimmed names while preserving first occurrence')
    goal =
      'Independently verify the exact local base/head in scope.md, inspect the change and regression, and report evidence and stable patch identity. Publication-preparation or stacker roles may organize local review artifacts only. Do not publish, merge, push, or operate on remote stack state.'
    if (id.startsWith('flow-')) {
      await writeFile(
        join(directory, 'verification-lanes.md'),
        '# Local verification predicates\n\nUse these thirteen bounded predicates when the requested block requires thirteen lanes.\n\n1. Trim one name.\n2. Trim several names.\n3. Remove empty strings.\n4. Remove spaces-only strings.\n5. Remove tabs-only strings.\n6. Deduplicate equal names.\n7. Deduplicate after trimming.\n8. Preserve first occurrence.\n9. Preserve case sensitivity.\n10. Preserve an empty input.\n11. Return JSON from the CLI.\n12. Keep input arrays unchanged.\n13. Probe 10000 inputs and report elapsed time without inventing a performance threshold.\n\nRun real assertions with Bun against the exact head. Keep verifier patches separate.\n',
      )
      goal = `Execute only the named local verification block against the committed base/head in scope.md. Read verification-lanes.md for thirteen concrete predicates and a local performance probe. ${id === 'flow-multi-phase-thirteen-lanes' ? 'Execute the thirteen-lane verification block, not merely plan authorship. If the source first requires a plan, save it to plan.md and then execute the requested block.' : 'The implementation phase is already complete in the supplied commit. Run the full or light verification variant specified by this case.'} Run serially or in waves of at most three active children. Do not run publication or unrelated development phases.`
    }
  } else if (id.includes('arena') || id.includes('architect')) {
    await writeFile(
      join(directory, 'request.md'),
      'Support newline-delimited stdin with a --stdin flag alongside argv. Preserve normalization and JSON output. Choose a clear error contract for mixing --stdin and argv. Provide usage first, then design and rationale.\n',
    )
    await mkdir(join(directory, 'alternatives'), { recursive: true })
    await writeFile(
      join(directory, 'alternatives/one.md'),
      'Keep argv parsing in cli.js. Add a separate readStdin function and pass either input source through normalizeNames. Reject mixed inputs. This keeps IO at the CLI boundary.\n',
    )
    await writeFile(
      join(directory, 'alternatives/two.md'),
      'Make normalizeNames read stdin and inspect process.argv itself. Concatenate both input sources. This gives callers fewer arguments but couples the domain function to process IO.\n',
    )
    goal = scenario.id.includes('judge')
      ? 'Compare the two supplied local design alternatives against request.md and the current code. Recommend a base, justify each criterion, and identify useful grafts. Do not invent candidate execution or implementation results.'
      : 'Follow request.md. A candidate builds its isolated proposal and rationale. An Architect role produces caller-first types, signatures, boundaries, and rationale, and stops before implementation. Full local Arena/Architect workflows must independently compare real alternatives before synthesis.'
  } else if (id.includes('visual')) {
    await writeFile(
      join(directory, 'reference.html'),
      '<!doctype html><meta charset="utf-8"><title>Name list</title><body style="margin:24px;background:#fff;color:#111;font:16px sans-serif"><h1 style="font-size:24px">Names</h1><ul style="padding:16px;border:1px solid #ddd"><li>Ada</li><li>Lin</li></ul></body>',
    )
    await writeFile(
      join(directory, 'target.html'),
      await readFile(join(directory, 'reference.html'), 'utf8'),
    )
    goal =
      'Migrate target.html inline styles to CSS classes without changing the rendered pixels. reference.html is immutable. Capture a local file:// baseline and target at the same viewport with agent-browser using a unique session, compare screenshots, and close only that session. No external URLs or dependencies. If a matching capture or image-diff capability fails, report the blocker rather than claiming visual parity.'
  }
  if (
    [
      'how-synthesis',
      'why-synthesis',
      'reflect-synthesizer',
      'trail-cross-review',
      'pickup-reducer',
      'orchestrate-brief-auditor',
      'orchestrate-retro-reader',
    ].includes(id)
  ) {
    await writeFile(
      join(directory, 'supplied-input.md'),
      '# Supplied fixture input\n\nThese are harness-authored source observations and a proposed brief, not outputs from executed upstream agents.\n\n- cli.js owns argv and prints a JSON array.\n- names.js trims each input and removes blank results.\n- Current duplicate values survive.\n- The proposed change deduplicates after trimming and preserves first occurrence and case sensitivity.\n- Acceptance requires a reproducing regression, a passing suite, actual CLI evidence, independent review, and no external actions.\n- baseline-check.json contains a real harness-executed local test receipt.\n- No ticket, chat, production trace, or remote change is supplied.\n\nResume point: implementation is not started. The next owner must inspect the contract and reproduce duplicate output. No completed implementation or review is claimed.\n',
    )
    goal = `Perform only your assigned ${scenario.role ?? id} operation on supplied-input.md, baseline-check.json, local source, and any prior local session_history evidence. Synthesize observations, review the proposed brief, or reduce the resume handoff as appropriate. Preserve the distinction between supplied fixture observations, real command receipts, and actual agent execution. Do not claim missing upstream phases executed.`
  }
  if (id === 'recall-slice')
    goal =
      'Root: use project-scoped session_history to collect the prior local fixture session, excluding the current session and children. Retrieve bounded audit read, timeline, and actual tool activity, then pass that evidence with stable references to exactly one read-only Recall slice reducer. The leaf reduces only the supplied session evidence and does not need ambient session_history. Preserve actual commands and results, omit unsupported status claims, and stop before unrelated external investigations.'
  if (id.includes('automate'))
    goal =
      'Run only the three-slice history-mining phase. Use project-scoped session_history to collect the three prior local fixture sessions, exclude the current session and children, and explicitly assign oldest, middle, and newest slices. Return and cross-check evidenced preferences for this fictional fixture only. Do not ask questions, author a personal skill, or publish. Standalone slice probes analyze only their assigned slice supplied by the root.'
  if (id.includes('reflect'))
    goal =
      'Reflect on the actual prior local fixture session through project-scoped session_history, preserving tool-activity evidence. Run only the assigned role or the requested judgment/tooling/divergent/synthesis workflow. Do not infer real-user preferences from fictional fixture instructions. Propose improvements but do not edit installed skills. If a required different-family reviewer is unavailable, report that exact blocked phase.'
  if (goal !== undefined) {
    if (id.includes('perf') || id.includes('hillclimb'))
      goal +=
        ' The immutable node correctness-gate.js must pass before and after every candidate. Do not change either gate or workload.'
    await writeFile(
      join(directory, 'README.md'),
      `# Local name-list scenario\n\n${goal}\n\nRun bun test for baseline regressions and use scope.md for exact repository identity. This scenario supersedes any generic deduplication enhancement request.\n`,
    )
    await writeFile(
      join(directory, 'evidence.md'),
      '# Evidence provenance\n\nThe repository, commands, measurements, and commits are local fixtures. scope.md defines the active request. No chat, tickets, production telemetry, or external decisions are supplied. Do not invent them.\n',
    )
  }
  const head = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim()
  const verified = await execute('bun', ['test'], { cwd: directory }).then(
    (result) => ({ success: true, stdout: result.stdout, stderr: result.stderr }),
    (failure) => ({ success: false, stdout: failure.stdout, stderr: failure.stderr }),
  )
  await writeFile(
    join(directory, 'scope.md'),
    `# Local scope\n\nBase: ${base}\nHead: ${head}\n\nOnly this disposable repository and its named local worktrees are authorized. No remote is configured.\n\nBaseline test success: ${verified.success}\n\n${goal ?? 'Read README.md and evidence.md for the assigned bounded task.'}\n`,
  )
  await writeFile(join(directory, 'baseline-check.json'), JSON.stringify(verified, null, 2))
  return goal
}
