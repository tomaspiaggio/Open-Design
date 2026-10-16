import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import starterTokens from '../../../packages/acme-system/tokens.json'

export type DesignTokens = {
  name: string
  /** A portable shadcn/Tailwind v4 theme stylesheet, when this system was imported from one. */
  shadcnCss?: string
  tokens: {
    color: { ink: string; canvas: string; brand: string; accent: string; muted: string }
    font: { display: string; body: string }
    radius: { card: string }
  }
}

const generatedRoot = join(import.meta.dirname, '../generated')
const systemsRoot = join(generatedRoot, 'design-systems')
const settingsPath = join(generatedRoot, 'project.json')
const chatPath = join(generatedRoot, 'conversation.json')

export function systemCss(tokens: DesignTokens) {
  if (tokens.shadcnCss) return tokens.shadcnCss
  const c = tokens.tokens.color
  const f = tokens.tokens.font
  return `@theme {\n  --color-ink: ${c.ink};\n  --color-canvas: ${c.canvas};\n  --color-brand: ${c.brand};\n  --color-accent: ${c.accent};\n  --color-muted: ${c.muted};\n  --font-display: ${f.display};\n  --font-body: ${f.body};\n  --radius-card: ${tokens.tokens.radius.card};\n}\n:root {\n  --od-ink: ${c.ink}; --od-canvas: ${c.canvas}; --od-brand: ${c.brand};\n  --od-accent: ${c.accent}; --od-muted: ${c.muted};\n  --od-font-display: ${f.display}; --od-font-body: ${f.body};\n}`
}

export function tailwindPreset(tokens: DesignTokens) {
  return `/** Generated reusable preset for ${tokens.name}. */\nexport default {\n  theme: { extend: {\n    colors: ${JSON.stringify(tokens.tokens.color, null, 6)},\n    fontFamily: ${JSON.stringify(tokens.tokens.font, null, 6)},\n    borderRadius: ${JSON.stringify(tokens.tokens.radius, null, 6)},\n  } },\n}\n`
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

export async function ensureProject() {
  await mkdir(systemsRoot, { recursive: true })
  const settings = await readJson(settingsPath, { activeSystem: 'acme', projectType: 'presentation' as const })
  if (!settings.projectType) settings.projectType = 'presentation'
  const defaultDir = join(systemsRoot, 'acme')
  await mkdir(defaultDir, { recursive: true })
  const tokensPath = join(defaultDir, 'tokens.json')
  const tokens = await readJson<DesignTokens>(tokensPath, starterTokens as DesignTokens)
  await saveDesignSystem('acme', tokens)
  await writeJson(settingsPath, settings)
  return settings
}

export async function setProjectType(projectType: 'presentation' | 'prototype') {
  const settings = await ensureProject()
  await writeJson(settingsPath, { ...settings, projectType })
  return projectType
}

export async function getDesignSystem(id?: string) {
  const settings = await ensureProject()
  const activeId = id ?? settings.activeSystem
  const dir = join(systemsRoot, activeId)
  const tokens = await readJson<DesignTokens>(join(dir, 'tokens.json'), starterTokens as DesignTokens)
  return { id: activeId, tokens }
}

export async function listDesignSystems() {
  await ensureProject()
  const { readdir } = await import('node:fs/promises')
  const names = await readdir(systemsRoot, { withFileTypes: true })
  return names.filter(entry => entry.isDirectory()).map(entry => entry.name)
}

export async function saveDesignSystem(id: string, tokens: DesignTokens) {
  const dir = join(systemsRoot, id)
  await mkdir(dir, { recursive: true })
  await writeJson(join(dir, 'tokens.json'), tokens)
  await writeFile(join(dir, 'theme.css'), systemCss(tokens), 'utf8')
  await writeFile(join(dir, 'tailwind.preset.ts'), tailwindPreset(tokens), 'utf8')
  await writeJson(join(dir, 'manifest.json'), { id, name: tokens.name, files: ['tokens.json', 'theme.css', 'tailwind.preset.ts'], version: 1 })
  return { id, tokens }
}

export async function exportDesignSystem(id: string) {
  const dir = join(systemsRoot, id)
  const [tokens, theme, preset, manifest] = await Promise.all([
    readFile(join(dir, 'tokens.json'), 'utf8'),
    readFile(join(dir, 'theme.css'), 'utf8'),
    readFile(join(dir, 'tailwind.preset.ts'), 'utf8'),
    readFile(join(dir, 'manifest.json'), 'utf8'),
  ])
  return { id, tokens, theme, preset, manifest }
}

export async function selectDesignSystem(id: string) {
  if (!(await listDesignSystems()).includes(id)) throw new Error(`Unknown design system: ${id}`)
  const settings = await ensureProject()
  await writeJson(settingsPath, { ...settings, activeSystem: id })
}

export async function createDesignSystem(name: string) {
  const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!id) throw new Error('Give the design system a name.')
  const tokens = structuredClone(starterTokens) as DesignTokens
  tokens.name = name.trim()
  await saveDesignSystem(id, tokens)
  await selectDesignSystem(id)
  return { id, tokens }
}

export async function readConversation() {
  return readJson<{ messages: Array<{ id: string; role: 'user' | 'assistant'; text: string; createdAt: string }> }>(chatPath, { messages: [] })
}

export async function saveConversation(conversation: Awaited<ReturnType<typeof readConversation>>) {
  await writeJson(chatPath, conversation)
}

export const projectPaths = { generatedRoot, systemsRoot, settingsPath, chatPath }
