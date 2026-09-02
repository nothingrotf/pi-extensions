import { readFile } from 'node:fs/promises'

import { parseFrontmatter, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

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
const capabilityDiscoveryEvent = '@nothingrotf/subagent/discover-capability-profiles'
const capabilityRegistrationEvent = '@nothingrotf/subagent/register-capability-profiles'
const sourceId = '@nothingrotf/pstack'

interface AgentDefinition {
  description: string
  is_background?: boolean
  name: string
  systemPrompt: string
}

async function loadAgent(path: string, label: string): Promise<AgentDefinition> {
  const content = await readFile(new URL(path, import.meta.url), 'utf8')
  const parsed = parseFrontmatter(content)
  if (!Value.Check(AgentMetadataSchema, parsed.frontmatter)) {
    throw new Error(`${label} requires a name and description.`)
  }
  const { description, is_background, name } = Value.Decode(AgentMetadataSchema, parsed.frontmatter)
  const systemPrompt = parsed.body.trim()
  if (systemPrompt.length === 0) throw new Error(`${label} requires a prompt body.`)
  const definition: AgentDefinition = { description, name, systemPrompt }
  if (is_background !== undefined) definition.is_background = is_background
  return definition
}

export default async function pstack(pi: ExtensionAPI): Promise<void> {
  const definitions = await Promise.all([
    loadAgent('../agents/comment-sicko.md', 'Comment Sicko'),
    loadAgent('../agents/poteto-agent.md', 'poteto-agent'),
  ])
  const publishAgents = () => {
    pi.events.emit(registrationEvent, { definitions, sourceId })
  }
  const publishCapabilityProfiles = () => {
    pi.events.emit(capabilityRegistrationEvent, {
      profiles: [{ id: 'pstack-nested', nested: { maxDepth: 3 }, registrations: [] }],
      sourceId,
    })
  }
  const unsubscribeAgents = pi.events.on(discoveryEvent, publishAgents)
  const unsubscribeCapabilityProfiles = pi.events.on(
    capabilityDiscoveryEvent,
    publishCapabilityProfiles,
  )
  publishAgents()
  publishCapabilityProfiles()
  pi.on('session_shutdown', () => {
    unsubscribeAgents()
    unsubscribeCapabilityProfiles()
  })
}
