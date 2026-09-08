import { readFile } from 'node:fs/promises'

import { parseFrontmatter, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createSessionTodoTools } from '@nothingrotf/todo/headless'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { loadPstackBootstrap } from './bootstrap.ts'
import {
  loadPstackModelPolicy,
  renderPstackModelPolicy,
  type PstackModelPolicyOptions,
} from './model-policy.ts'

const AgentMetadataSchema = Type.Object(
  {
    description: Type.String({ minLength: 1 }),
    is_background: Type.Optional(Type.Boolean()),
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
)

const discoveryEvent = '@nothingrotf/subagent/discover-agents'
const registrationEvent = '@nothingrotf/subagent/register-agents'
const toolDiscoveryEvent = '@nothingrotf/subagent/discover-capabilities'
const toolRegistrationEvent = '@nothingrotf/subagent/register-capabilities'
const capabilityDiscoveryEvent = '@nothingrotf/subagent/discover-capability-profiles'
const capabilityRegistrationEvent = '@nothingrotf/subagent/register-capability-profiles'
const sourceId = '@nothingrotf/pstack'

interface AgentDefinition {
  capabilityProfile: string
  description: string
  is_background?: boolean
  name: string
  systemPrompt: string
}

async function loadAgent(path: string, label: string, skillRoot: string): Promise<AgentDefinition> {
  const content = await readFile(new URL(path, import.meta.url), 'utf8')
  const parsed = parseFrontmatter(content)
  if (!Value.Check(AgentMetadataSchema, parsed.frontmatter)) {
    throw new Error(`${label} requires a name and description.`)
  }
  const { description, is_background, name } = Value.Decode(AgentMetadataSchema, parsed.frontmatter)
  const systemPrompt = parsed.body.trim().replaceAll('{{PSTACK_SKILLS_ROOT}}', skillRoot)
  if (systemPrompt.length === 0) throw new Error(`${label} requires a prompt body.`)
  const definition: AgentDefinition = {
    capabilityProfile: 'pstack-leaf',
    description,
    name,
    systemPrompt,
  }
  if (is_background !== undefined) definition.is_background = is_background
  return definition
}

export default async function pstack(
  pi: ExtensionAPI,
  options: PstackModelPolicyOptions = {},
): Promise<void> {
  const bootstrap = await loadPstackBootstrap()
  let modelPolicy = await loadPstackModelPolicy(options)
  let policyPrompt = renderPstackModelPolicy(modelPolicy)
  const refreshPolicy = async () => {
    const next = await loadPstackModelPolicy(options)
    const nextPrompt = renderPstackModelPolicy(next)
    if (nextPrompt === policyPrompt) return
    modelPolicy = next
    policyPrompt = nextPrompt
    publishCapabilities()
  }
  pi.on('before_agent_start', async (event) => {
    await refreshPolicy()
    return { systemPrompt: `${event.systemPrompt}\n\n${policyPrompt}` }
  })
  pi.on('tool_call', async (event) => {
    if (event.toolName === 'Task') await refreshPolicy()
  })
  const definitions = await Promise.all([
    loadAgent('../agents/comment-sicko.md', 'Comment Sicko', bootstrap.root),
    loadAgent('../agents/poteto-agent.md', 'poteto-agent', bootstrap.root),
  ])
  const publishCapabilities = () => {
    pi.events.emit(toolRegistrationEvent, {
      registrations: [
        {
          createTools: createSessionTodoTools,
          extensions: [],
          id: 'pstack-planning',
          modelPolicy,
          readonlyTools: ['todo_write', 'todo_read'],
          systemPrompt: `${bootstrap.systemPrompt}\n\n${policyPrompt}`,
          tools: createSessionTodoTools(),
          version: '1',
        },
      ],
      sourceId,
    })
  }
  const publishAgents = () => {
    pi.events.emit(registrationEvent, { definitions, sourceId })
  }
  const publishCapabilityProfiles = () => {
    pi.events.emit(capabilityRegistrationEvent, {
      profiles: [
        { id: 'pstack-leaf', registrations: ['pstack-planning'] },
        { id: 'pstack-nested', nested: { maxDepth: 3 }, registrations: ['pstack-planning'] },
      ],
      sourceId,
    })
  }
  const unsubscribeCapabilities = pi.events.on(toolDiscoveryEvent, publishCapabilities)
  const unsubscribeAgents = pi.events.on(discoveryEvent, publishAgents)
  const unsubscribeCapabilityProfiles = pi.events.on(
    capabilityDiscoveryEvent,
    publishCapabilityProfiles,
  )
  publishCapabilities()
  publishAgents()
  publishCapabilityProfiles()
  pi.on('session_shutdown', () => {
    unsubscribeCapabilities()
    unsubscribeAgents()
    unsubscribeCapabilityProfiles()
  })
}
