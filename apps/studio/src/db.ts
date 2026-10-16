import { PrismaClient } from '@prisma/client'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureProject as ensureLegacyProject, getDesignSystem, listDesignSystems } from './project.js'
import { getStrategy, type StrategyId } from './strategies.js'
import type { DesignTokens } from './project.js'

const globalForPrisma = globalThis as typeof globalThis & { openDesignPrisma?: PrismaClient }
process.env.DATABASE_URL ??= 'postgresql://opendesign:opendesign@localhost:5432/opendesign?schema=public'
const basePrisma = globalForPrisma.openDesignPrisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.openDesignPrisma = basePrisma
const agentDbContext = new AsyncLocalStorage<(model: string, operation: string) => void>()
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const onQuery = agentDbContext.getStore()
        if (onQuery && model !== 'AgentRun' && model !== 'AgentRunEvent') onQuery(model, operation)
        return query(args)
      },
    },
  },
})

export function withAgentDbTelemetry<T>(onQuery: (model: string, operation: string) => void, run: () => Promise<T>) {
  return agentDbContext.run(onQuery, run)
}

const here = fileURLToPath(new URL('.', import.meta.url))
const generatedRoot = join(here, '../generated')

export async function initializeDatabase() {
  await ensureLegacyProject()
  for (const id of await listDesignSystems()) {
    const { tokens } = await getDesignSystem(id)
    await prisma.designSystem.upsert({ where: { id }, update: { name: tokens.name, tokens: tokens as never }, create: { id, name: tokens.name, tokens: tokens as never } })
  }
  if (await prisma.project.count() > 0) return

  const legacyDeck = await readFile(join(generatedRoot, 'deck/index.html'), 'utf8').catch(() => getStrategy('presentation').starterHtml)
  const title = legacyDeck.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() || 'Untitled presentation'
  await prisma.project.create({
    data: { title, strategy: 'presentation', designSystemId: 'acme', active: true, description: 'Imported from the existing HTML workspace.', files: { create: { path: 'index.html', content: legacyDeck } } },
  })
}

export async function listProjects() {
  const projects = await prisma.project.findMany({ orderBy: [{ updatedAt: 'desc' }], include: { files: { select: { content: true } } } })
  return projects.map(({ files, ...project }) => ({ ...project, sourceBytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) }))
}

export async function getProject(id: string) {
  const project = await prisma.project.findUnique({ where: { id }, include: { files: { orderBy: { path: 'asc' } }, messages: { orderBy: { createdAt: 'asc' } } } })
  if (!project) throw new Error(`Project not found: ${id}`)
  return project
}

export async function createProject(strategyId: string, title: string, brief: string, designSystemId = 'acme') {
  const strategy = getStrategy(strategyId)
  if (!(await prisma.designSystem.findUnique({ where: { id: designSystemId }, select: { id: true } }))) throw new Error(`Unknown design system: ${designSystemId}`)
  const projectTitle = title.trim() || strategy.starterTitle
  const projectSystemId = strategy.cloneDesignSystem ? `system-${crypto.randomUUID()}` : designSystemId
  const baseSystem = strategy.cloneDesignSystem ? await prisma.designSystem.findUniqueOrThrow({ where: { id: designSystemId } }) : null
  const starterFiles = strategy.createFiles(projectTitle, baseSystem?.tokens)
  const project = await prisma.$transaction(async tx => {
    await tx.project.updateMany({ where: { active: true }, data: { active: false } })
    if (baseSystem) await tx.designSystem.create({ data: { id: projectSystemId, name: projectTitle, tokens: baseSystem.tokens as never } })
    return tx.project.create({ data: {
      title: projectTitle,
      description: brief.trim(), strategy: strategy.id, designSystemId: projectSystemId, active: true,
      files: { create: starterFiles },
    } })
  })
  return project
}

export async function activateProject(id: string) {
  await getProject(id)
  await prisma.$transaction([
    prisma.project.updateMany({ where: { active: true }, data: { active: false } }),
    prisma.project.update({ where: { id }, data: { active: true } }),
  ])
  return getProject(id)
}

export async function setProjectSystem(projectId: string, designSystemId: string) {
  await prisma.$transaction([
    prisma.project.update({ where: { id: projectId }, data: { designSystemId } }),
  ])
  return getProject(projectId)
}

export async function readProjectFile(projectId: string, path: string) {
  const file = await prisma.projectFile.findUnique({ where: { projectId_path: { projectId, path } } })
  if (!file) throw new Error(`File not found in project: ${path}`)
  return file.content
}

export async function writeProjectFile(projectId: string, path: string, content: string) {
  await prisma.projectFile.upsert({ where: { projectId_path: { projectId, path } }, update: { content }, create: { projectId, path, content } })
  if (path === 'index.html') {
    const title = content.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim()
    if (title) await prisma.project.update({ where: { id: projectId }, data: { title, updatedAt: new Date() } })
    else await prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } })
  } else await prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } })
  return { path, bytes: Buffer.byteLength(content) }
}

export async function listProjectFiles(projectId: string) {
  const files = await prisma.projectFile.findMany({ where: { projectId }, orderBy: { path: 'asc' }, select: { path: true } })
  return files.map(file => file.path)
}

export async function addMessage(projectId: string, role: 'user' | 'assistant', text: string) {
  return prisma.$transaction(async tx => {
    const message = await tx.message.create({ data: { projectId, role, text } })
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } })
    return message
  })
}

export async function getProjectMessages(projectId: string) {
  return prisma.message.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })
}

export async function clearProjectMessages(projectId: string) {
  await prisma.message.deleteMany({ where: { projectId } })
}

export async function getSystems() {
  return prisma.designSystem.findMany({ orderBy: { updatedAt: 'desc' } })
}

export async function getSystem(id: string) {
  const system = await prisma.designSystem.findUnique({ where: { id } })
  if (!system) throw new Error(`Unknown design system: ${id}`)
  return { id: system.id, tokens: system.tokens as unknown as DesignTokens }
}

export async function saveSystem(id: string, tokens: DesignTokens) {
  await prisma.designSystem.upsert({ where: { id }, update: { name: tokens.name, tokens: tokens as never }, create: { id, name: tokens.name, tokens: tokens as never } })
  return { id, tokens }
}

export async function createSystem(name: string, id: string, tokens: DesignTokens) {
  await prisma.designSystem.create({ data: { id, name, tokens: tokens as never } })
  return { id, tokens }
}

export async function storeThumbnail(projectId: string, html: string) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(100)
    const stage = page.locator('.stage').first()
    const slide = page.locator('.slide, [data-od-slide]').first()
    const captureTarget = await stage.count() ? stage : await slide.count() ? slide : page.locator('body')
    const data = `data:image/png;base64,${(await captureTarget.screenshot({ type: 'png', animations: 'disabled' })).toString('base64')}`
    await prisma.project.update({ where: { id: projectId }, data: { thumbnailData: data } })
    return data
  } finally { await browser.close() }
}

export type { StrategyId }
