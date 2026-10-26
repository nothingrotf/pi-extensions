import { describe, it } from 'vite-plus/test'

import { runWorkflowCase, workflowGroup } from './sdk-harness.js'

describe('pstack workflow SDK contracts for writers', () => {
  it.each(workflowGroup('writers'))(
    '$id: dispatch, tools, evidence, role, gates and acceptance',
    (scenario) => runWorkflowCase(scenario),
    30_000,
  )
})
