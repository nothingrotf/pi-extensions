const playbook = (name) => `poteto-mode/playbooks/${name}.md`
const skill = (name) => `${name}/SKILL.md`

function leaf(id, source, role, kind = 'static') {
  return { id, source, role, kind, profile: 'pstack-leaf', type: 'generalPurpose' }
}

function writer(id, source, role, profile = 'pstack-leaf') {
  return { id, source, role, kind: 'writer', profile, type: 'poteto-agent' }
}

export const workflowCases = [
  leaf('how-simple', skill('how'), 'how explainer'),
  leaf('how-explorer', skill('how'), 'how explorer'),
  leaf('how-synthesis', skill('how'), 'how explainer'),
  ...['source-control', 'tickets', 'documents', 'chat', 'observability', 'errors', 'analytics'].map(
    (category) => leaf(`why-${category}`, skill('why'), 'why investigators'),
  ),
  leaf('why-followup', skill('why'), 'why investigators'),
  leaf('why-synthesis', skill('why'), 'why synthesizer'),
  ...['judgment', 'tooling', 'divergent', 'synthesizer'].map((lens) =>
    leaf(`reflect-${lens}`, skill('reflect'), `reflect ${lens}`),
  ),
  leaf('interrogate-reviewer', skill('interrogate'), 'interrogate reviewers'),
  leaf('recall-slice', skill('recall'), 'judgment and prose'),
  ...['early', 'middle', 'recent'].map((slice) =>
    leaf(`automate-${slice}`, skill('automate-me'), 'judgment and prose'),
  ),
  leaf('verification-source-reader', skill('maintain-verification-skill'), 'judgment and prose'),
  leaf('trail-cross-review', skill('show-me-your-work'), 'code review'),
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
    ...writer('architect-sketch', skill('architect'), 'architect runners'),
    type: 'generalPurpose',
    integration: 'branch',
  },
  {
    ...leaf('comment-cleanup', skill('no-comments'), 'code review'),
    type: 'Comment Sicko',
  },
  writer('feature-leaf', playbook('feature'), 'feature'),
  writer('feature-owner', playbook('feature'), 'feature', 'pstack-nested'),
  writer('refactoring', playbook('refactoring'), 'refactoring'),
  writer('bug-fix', playbook('bug-fix'), 'bug-fix'),
  writer('perf-issue', playbook('perf-issue'), 'perf-issue'),
  writer('hillclimb', playbook('hillclimb'), 'hillclimb'),
  leaf('shipping-static', playbook('shipping'), 'code review'),
  leaf('shipping-runtime', playbook('shipping'), 'runtime verification', 'verifier'),
  writer('orchestrate-worker', playbook('orchestrate'), 'feature'),
  writer('orchestrate-track', playbook('orchestrate'), 'hardest tasks', 'pstack-nested'),
  leaf('orchestrate-static', playbook('orchestrate'), 'code review'),
  leaf('orchestrate-runtime', playbook('orchestrate'), 'runtime verification', 'verifier'),
  writer('autopilot-full-owner', playbook('autopilot-full'), 'feature', 'pstack-nested'),
  writer('autopilot-stack-owner', playbook('autopilot-stack'), 'feature', 'pstack-nested'),
  leaf('multi-phase-explorer', playbook('multi-phase-plan'), 'hardest tasks'),
  leaf('multi-phase-live-lane', playbook('multi-phase-plan'), 'swarm workers', 'verifier'),
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
  writer('bespoke-worker', skill('figure-it-out'), 'hardest tasks', 'pstack-nested'),
  leaf('bespoke-judge', skill('figure-it-out'), 'judgment and prose'),
  {
    ...leaf('pickup-reducer', playbook('session-pickup'), 'judgment and prose'),
    type: 'poteto-agent',
  },
  {
    ...leaf('worktree-investigator', playbook('worktree-cleanup'), 'judgment and prose'),
    type: 'poteto-agent',
  },
  leaf('publication-destination', playbook('opening-a-pr'), 'publication', 'publication'),
  leaf('orchestrate-brief-auditor', playbook('orchestrate'), 'code review'),
  writer('orchestrate-stacker', playbook('orchestrate'), 'refactoring'),
  leaf('orchestrate-babysitter', playbook('orchestrate'), 'runtime verification', 'verifier'),
  leaf('orchestrate-retro-reader', playbook('orchestrate'), 'judgment and prose'),
]
