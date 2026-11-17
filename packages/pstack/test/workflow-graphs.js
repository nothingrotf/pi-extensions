export const workflowGraphs = [
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
]
