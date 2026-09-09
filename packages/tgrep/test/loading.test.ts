import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vite-plus/test'

const hudPath = fileURLToPath(new URL('../../hud/src/index.ts', import.meta.url))
const tgrepPath = fileURLToPath(new URL('../src/index.ts', import.meta.url))

test.each([
  [hudPath, tgrepPath],
  [tgrepPath, hudPath],
])('loads HUD and tgrep without tool conflicts: %s first', async (first, second) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-tgrep-loading-'))
  try {
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: join(root, 'agent'),
      settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [first, second],
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
    })
    await loader.reload()
    const result = loader.getExtensions()
    expect(result.errors).toEqual([])
    const owners = result.extensions.filter((extension) => extension.tools.has('grep'))
    expect(owners.map((extension) => extension.resolvedPath)).toEqual([tgrepPath])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
