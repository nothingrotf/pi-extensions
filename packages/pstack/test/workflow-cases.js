const playbook = (name) => `poteto-mode/playbooks/${name}.md`
const skill = (name) => `${name}/SKILL.md`

function leaf(id, source, role, kind = 'static') {
  return { id, source, role, kind, profile: 'pstack-leaf', type: 'generalPurpose' }
}

function writer(id, source, role, profile = 'pstack-leaf') {
  return { id, source, role, kind: 'writer', profile, type: 'poteto-agent' }
}

export const workflowCases = [
  leaf('how-explainer', skill('how'), 'judgment and prose'),
  leaf('interrogate-reviewer', skill('interrogate'), 'interrogate reviewers', 'verifier'),
  leaf('recall-slice', skill('recall'), 'judgment and prose'),
  ...['early', 'middle', 'recent'].map((slice) =>
    leaf(`automate-${slice}`, skill('automate-me'), 'judgment and prose'),
  ),
  leaf('verification-source-reader', skill('maintain-verification-skill'), 'judgment and prose'),
  leaf('trail-cross-review', skill('show-me-your-work'), 'arena cross-judge pool'),
  ...['partition', 'race', 'mixed'].map((strategy) =>
    leaf(`swarm-${strategy}`, skill('swarm'), 'swarm workers'),
  ),
  leaf('swarm-runtime', skill('swarm'), 'swarm workers', 'verifier'),
  {
    ...writer('swarm-writer', skill('swarm'), 'swarm workers'),
    type: 'generalPurpose',
    integration: 'branch',
  },
  {
    ...writer('arena-candidate', skill('arena'), 'arena runners'),
    type: 'generalPurpose',
    integration: 'branch',
  },
  leaf('arena-judge', skill('arena'), 'arena cross-judge pool'),
  {
    ...writer('comment-cleanup', skill('no-comments'), 'swarm workers'),
    type: 'comment-sicko',
  },
  writer('feature-leaf', playbook('feature'), 'feature'),
  writer('feature-owner', playbook('feature'), 'feature', 'pstack-nested'),
  writer('refactoring', playbook('refactoring'), 'refactoring'),
  writer('bug-fix', playbook('bug-fix'), 'bug-fix'),
  writer('perf-issue', playbook('perf-issue'), 'perf-issue'),
  writer('hillclimb', playbook('hillclimb'), 'hillclimb'),
  leaf('shipping-static', playbook('shipping'), 'swarm workers'),
  leaf('shipping-runtime', playbook('shipping'), 'swarm workers', 'verifier'),
  writer('autopilot-full-owner', playbook('autopilot-full'), 'feature', 'pstack-nested'),
  writer('autopilot-stack-owner', playbook('autopilot-stack'), 'feature', 'pstack-nested'),
  {
    ...writer('eval-candidate', playbook('eval'), 'arena runners'),
    type: 'generalPurpose',
    integration: 'branch',
  },
  leaf('eval-judge', playbook('eval'), 'arena cross-judge pool'),
  {
    ...leaf('bulk-reducer', skill('principle-guard-the-context-window'), 'judgment and prose'),
    type: 'poteto-agent',
  },
  {
    ...leaf('bug-how-owner', playbook('bug-fix'), 'bug-fix'),
    type: 'poteto-agent',
    profile: 'pstack-nested',
  },
  {
    ...leaf('bug-why-owner', playbook('bug-fix'), 'bug-fix'),
    type: 'poteto-agent',
    profile: 'pstack-nested',
  },
  writer('visual-parity-owner', playbook('visual-parity'), 'feature', 'pstack-nested'),
  {
    ...leaf('runtime-forensics-reader', playbook('runtime-forensics'), 'judgment and prose'),
    type: 'poteto-agent',
  },
  {
    ...leaf(
      'runtime-forensics-parser',
      playbook('runtime-forensics'),
      'judgment and prose',
      'verifier',
    ),
    type: 'poteto-agent',
  },
  {
    ...leaf('trace-forensics-reader', playbook('trace-forensics'), 'judgment and prose'),
    type: 'poteto-agent',
  },
  {
    ...leaf(
      'trace-forensics-parser',
      playbook('trace-forensics'),
      'judgment and prose',
      'verifier',
    ),
    type: 'poteto-agent',
  },
  writer('bespoke-worker', skill('figure-it-out'), 'feature', 'pstack-nested'),
  leaf('bespoke-judge', skill('figure-it-out'), 'judgment and prose'),
  {
    ...leaf('pickup-reducer', playbook('session-pickup'), 'judgment and prose'),
    type: 'poteto-agent',
  },
  {
    ...leaf('worktree-investigator', playbook('worktree-cleanup'), 'judgment and prose'),
    type: 'poteto-agent',
  },
]
