export const workflowGraphs = [
  {
    id: 'how-complex',
    nodes: [
      { id: 'state', scenario: 'how-explorer' },
      { id: 'request', scenario: 'how-explorer' },
      { id: 'explanation', scenario: 'how-synthesis', needs: ['state', 'request'] },
      { id: 'critic', scenario: 'how-critique', needs: ['explanation'] },
    ],
  },
  {
    id: 'why-full',
    nodes: [
      ...[
        'source-control',
        'tickets',
        'documents',
        'chat',
        'observability',
        'errors',
        'analytics',
      ].map((category) => ({ id: category, scenario: `why-${category}` })),
      {
        id: 'synthesis',
        scenario: 'why-synthesis',
        needs: [
          'source-control',
          'tickets',
          'documents',
          'chat',
          'observability',
          'errors',
          'analytics',
        ],
      },
    ],
  },
  {
    id: 'reflect',
    nodes: [
      ...['judgment', 'tooling', 'divergent'].map((lens) => ({
        id: lens,
        scenario: `reflect-${lens}`,
      })),
      {
        id: 'synthesizer',
        scenario: 'reflect-synthesizer',
        needs: ['judgment', 'tooling', 'divergent'],
      },
    ],
  },
  ...['partition', 'race', 'mixed'].map((strategy) => ({
    id: `swarm-${strategy}`,
    nodes: ['alpha', 'beta', 'gamma'].map((id) => ({ id, scenario: `swarm-${strategy}` })),
  })),
  {
    id: 'arena',
    nodes: [
      { id: 'alpha', scenario: 'arena-candidate' },
      { id: 'beta', scenario: 'arena-candidate' },
      { id: 'judge', scenario: 'arena-judge', needs: ['alpha', 'beta'] },
    ],
  },
  {
    id: 'architect',
    nodes: [
      { id: 'alpha', scenario: 'architect-sketch' },
      { id: 'beta', scenario: 'architect-sketch' },
      { id: 'judge', scenario: 'arena-judge', needs: ['alpha', 'beta'] },
    ],
  },
  {
    id: 'interrogate-panel',
    nodes: ['alpha', 'beta', 'gamma', 'delta'].map((id) => ({
      id,
      scenario: 'interrogate-reviewer',
    })),
  },
  {
    id: 'automate-slices',
    nodes: ['early', 'middle', 'recent'].map((id) => ({ id, scenario: `automate-${id}` })),
  },
  {
    id: 'maintenance-features',
    nodes: ['read', 'write', 'resume'].map((id) => ({
      id,
      scenario: 'verification-source-reader',
    })),
  },
  ...['autopilot-full', 'autopilot-stack'].map((mode) => ({
    id: `${mode}-verification`,
    nodes: ['gates', 'live', 'regression', 'audit'].map((id) => ({
      id,
      scenario: id === 'audit' ? 'swarm-partition' : 'swarm-runtime',
    })),
  })),
  {
    id: 'multi-phase-thirteen-lanes',
    nodes: [
      { id: 'gates', scenario: 'swarm-runtime' },
      ...[
        'regression',
        'alpha',
        'beta',
        'gamma',
        'delta',
        'epsilon',
        'zeta',
        'eta',
        'theta',
        'iota',
      ].map((id) => ({ id, scenario: 'multi-phase-live-lane' })),
      { id: 'perf', scenario: 'swarm-runtime' },
      { id: 'audit', scenario: 'swarm-partition' },
    ],
  },
]
