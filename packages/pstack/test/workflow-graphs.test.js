import { describe, it } from 'vite-plus/test'

import { runWorkflowGraph } from './sdk-harness.js'
import { workflowGraphs } from './workflow-graphs.js'

describe('pstack workflow SDK graphs with scripted model decisions', () => {
  it.each(workflowGraphs)(
    '$id relays every prerequisite through the real Task graph',
    (graph) => runWorkflowGraph(graph),
    60_000,
  )
})
