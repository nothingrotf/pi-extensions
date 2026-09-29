import { describe, expect, it } from 'vite-plus/test'

import { withUsableProvider } from '../src/model.ts'

const codex = { provider: 'openai-codex', id: 'gpt-6.1-sol' }
const openai = { provider: 'openai', id: 'gpt-6.1-sol' }
const codexOnly = { provider: 'openai-codex', id: 'codex-only' }
const anthropic = { provider: 'anthropic', id: 'claude' }
const models = [codex, openai, codexOnly, anthropic]

function auth(configured: readonly string[], subscriptions: readonly string[]) {
  return {
    hasConfiguredAuth: (provider: string) => configured.includes(provider),
    isUsingSubscription: (provider: string) => subscriptions.includes(provider),
  }
}

describe('OpenAI provider fallback', () => {
  it('keeps the selected provider when it has a login', () => {
    const both = auth(['openai', 'openai-codex'], ['openai', 'openai-codex'])
    expect(withUsableProvider(codex, models, both)).toBe(codex)
    expect(withUsableProvider(openai, models, both)).toBe(openai)
  })

  it('switches between the providers only for a ChatGPT subscription login', () => {
    expect(withUsableProvider(codex, models, auth(['openai'], ['openai']))).toBe(openai)
    expect(withUsableProvider(openai, models, auth(['openai-codex'], ['openai-codex']))).toBe(codex)
    expect(withUsableProvider(codex, models, auth(['openai'], []))).toBe(codex)
    expect(withUsableProvider(codex, models, auth([], []))).toBe(codex)
  })

  it('keeps models that the other provider does not offer', () => {
    const subscription = auth(['openai'], ['openai'])
    expect(withUsableProvider(codexOnly, models, subscription)).toBe(codexOnly)
    expect(withUsableProvider(anthropic, models, subscription)).toBe(anthropic)
  })
})
