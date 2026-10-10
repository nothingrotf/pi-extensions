export interface ReplayCriterion {
  description: string
  id: string
}

export interface ReplayTask {
  acceptance: readonly string[]
  brief: string
  criteria: readonly ReplayCriterion[]
  fix: string
  hiddenTests: readonly string[]
  id: string
  issue: string
}

export const replayTasks: readonly ReplayTask[] = [
  {
    id: 'diagnosis-owner',
    issue: 'REPLAY-DIAGNOSIS',
    fix: '16bb7e4ed1e38abb49459d50f4c4959ca6db7e4e',
    brief: [
      'In packages/pstack, nextDeliveryStep in src/delivery-next.ts decides the next managed delivery step.',
      'After a hardest tasks diagnosis is recorded for the current candidate, the correct step still tells the coordinator to resume the previous owner. The diagnosis cause therefore never reaches a fresh owner.',
      'Change the correct step so that a diagnosis recorded after the latest implementation submission requires a fresh owner. A later implementation submission restores the normal resume behavior.',
    ].join(' '),
    criteria: [
      {
        id: 'fresh-after-diagnosis',
        description:
          'When a diagnosis submission follows the latest implementation submission and the issue has a workspace, nextDeliveryStep returns step correct with resume null, and the instruction asks for a fresh owner with the recorded diagnosis.',
      },
      {
        id: 'resume-restored',
        description:
          'When a new implementation submission follows that diagnosis, nextDeliveryStep returns step correct with resume set to the agent ID of that latest owner again.',
      },
      {
        id: 'covered',
        description:
          'packages/pstack/test/delivery-next.test.ts covers both cases, and bunx vp test run packages/pstack passes.',
      },
    ],
    hiddenTests: ['packages/pstack/test/delivery-next.test.ts'],
    acceptance: ['bunx', 'vp', 'test', 'run', 'packages/pstack/test/delivery-next.test.ts'],
  },
  {
    id: 'workspace-setup',
    issue: 'REPLAY-SETUP',
    fix: '6b53028cd80b4b7094c5733a182f0d0705cf3019',
    brief: [
      'In packages/pstack, prepareIssueWorkspace in src/delivery-workspace.ts creates the issue worktree and runs .pstack/worktree-setup.sh.',
      'Two defects exist. First, setup waits on its output pipes, so a setup script that starts a background service never returns, and nothing bounds setup time. Second, a reused or recreated worktree reports the current source HEAD as its base instead of the commit the issue branch started from.',
    ].join(' '),
    criteria: [
      {
        id: 'background-service',
        description:
          'When .pstack/worktree-setup.sh exits 0 but leaves a background process that holds its output, prepareIssueWorkspace returns within 15 seconds with setup status passed and exitCode 0, and the background process keeps running.',
      },
      {
        id: 'setup-timeout',
        description:
          "Setup times out after 15 minutes by default. The PSTACK_SETUP_TIMEOUT_SECONDS environment variable sets the limit in seconds. On timeout, the whole setup process group is killed, including background children. The result is setup { status: 'failed', timedOut: true, log }, the log ends with 'Setup timed out after <n> seconds.', and workspaceBrief contains 'Environment setup timed out.'",
      },
      {
        id: 'recorded-base',
        description:
          'prepareIssueWorkspace records the base commit in the source repository Git config key branch.<branch>.pstackbase. A reused worktree, or a worktree recreated from the existing issue branch, reports that recorded base after the source HEAD advances. Without a valid record, the base is the merge base of the branch tip and the requested commit, and the record is written again.',
      },
      {
        id: 'covered',
        description:
          'packages/pstack/test/delivery-workspace.test.ts covers each behavior, and bunx vp test run packages/pstack passes.',
      },
    ],
    hiddenTests: ['packages/pstack/test/delivery-workspace.test.ts'],
    acceptance: ['bunx', 'vp', 'test', 'run', 'packages/pstack/test/delivery-workspace.test.ts'],
  },
]

export function replayTask(id: string): ReplayTask | undefined {
  return replayTasks.find((task) => task.id === id)
}

const ownerRoles: readonly string[] = [
  'feature',
  'refactoring',
  'bug-fix',
  'perf-issue',
  'hillclimb',
]

function rolesPolicy(policy: string, roles: readonly string[], selector: string): string {
  const lines = policy
    .split('\n')
    .filter((line) => !roles.includes(line.split(':')[0]?.trim() ?? ''))
  while (lines.at(-1)?.trim() === '') lines.pop()
  return `${[...lines, ...roles.map((role) => `${role}: ${selector}`)].join('\n')}\n`
}

export function ownerPolicy(policy: string, selector: string): string {
  return rolesPolicy(policy, ownerRoles, selector)
}

export function reviewerPolicy(policy: string, selector: string): string {
  return rolesPolicy(policy, ['code review'], selector)
}
