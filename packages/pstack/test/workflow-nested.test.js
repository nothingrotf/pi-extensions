import { describe, it } from 'vite-plus/test'

import { runWorkflowCase, workflowGroup } from './sdk-harness.js'

describe('pstack workflow SDK contracts for nested owners', () => {
  it.each(workflowGroup('nested'))(
    '$id: dispatch, tools, evidence, role, gates and acceptance',
    (scenario) => runWorkflowCase(scenario),
    30_000,
  )
})
