import { serve } from '@hono/node-server'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { streamText, stepCountIs, tool, wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { config } from 'dotenv'
import { createDesignSystem as createLegacyDesignSystem, exportDesignSystem, saveDesignSystem as saveLegacyDesignSystem, type DesignTokens } from './project.js'
import { activateProject, addMessage, clearProjectMessages, createProject, createSystem, getProject, getProjectMessages, getSystem, getSystems, initializeDatabase, listProjectFiles, listProjects, prisma, readProjectFile, saveSystem, setProjectSystem, storeThumbnail, withAgentDbTelemetry, writeProjectFile } from './db.js'
import { getStrategy, projectStrategies } from './strategies.js'
import { inspectPreviewHtml } from './preview-validation.js'

const here = dirname(fileURLToPath(import.meta.url))
config({ path: join(here, '../../../.env') })
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
const allowedExtensions = new Set(['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json'])
type JobEvent = { id: string; type: string; text: string; detail?: string; tables: string[]; createdAt: string }
type Job = { runId: string; projectId: string; done: boolean; error?: string; events: JobEvent[]; liveText: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; eventWrites: Promise<void> }
const jobs = new Map<string, Job>()

function safeProjectPath(path: string) {
  const target = normalize(path).replaceAll('\\', '/')
  if (target.startsWith('/') || target === '..' || target.startsWith('../') || !allowedExtensions.has(extname(target))) throw new Error('Only source files inside this project workspace may be accessed.')
  return target
}

async function presentationHtml(projectId: string, slide?: number) {
  const project = await getProject(projectId)
  const html = project.files.find(file => file.path === 'index.html')?.content ?? getStrategy(project.strategy).starterHtml
  const { tokens } = await getSystem(project.designSystemId ?? 'acme')
  const shadcnVars = tokens.shadcnCss ? [...tokens.shadcnCss.matchAll(/(:root|\.dark)\s*\{([^{}]*)\}/g)].map(([, selector, body]) => {
    const declarations = body.split(';').map(item => item.trim()).filter(item => item.startsWith('--')).filter(item => {
      const value = item.slice(item.indexOf(':') + 1)
      return !/[<>\u0000-\u001f{}]/.test(value)
    })
    return declarations.length ? `${selector}{${declarations.join(';')}}` : ''
  }).filter(Boolean).join('\n') : ''
  const theme = `:root { --od-ink:${tokens.tokens.color.ink}; --od-canvas:${tokens.tokens.color.canvas}; --od-brand:${tokens.tokens.color.brand}; --od-accent:${tokens.tokens.color.accent}; --od-muted:${tokens.tokens.color.muted}; --od-font-display:${tokens.tokens.font.display}; --od-font-body:${tokens.tokens.font.body}; }${shadcnVars ? `\n${shadcnVars}` : ''}`
  const strategy = getStrategy(project.strategy)
  const hostStyles = strategy.previewMode === 'canvas'
    ? `<style id="opendesign-host-styles">html,body{width:100%;height:100%;overflow:auto}</style>`
    : `<style id="opendesign-host-styles">html,body{width:100%;height:100%;overflow:hidden}</style>`
  const selectors = '.slide,[data-od-slide]'
  const hostScript = strategy.previewMode === 'slides'
    ? `<script id="opendesign-host-scaler">(()=>{const slides=[...document.querySelectorAll('${selectors}')];const fit=()=>{const s=document.querySelector('.stage');if(!s)return;const w=s.offsetWidth||1280,h=s.offsetHeight||720;s.style.scale=String(Math.min(innerWidth/w,innerHeight/h))};const selected=${slide ?? 0};if(selected>0&&slides.length){slides.forEach((s,i)=>{const on=i===selected-1;s.classList.toggle('active',on);s.setAttribute('aria-hidden',String(!on))});const counter=document.getElementById('counter');if(counter)counter.textContent=String(selected).padStart(2,'0')+' / '+String(slides.length);const progress=document.getElementById('progress');if(progress)progress.style.width=(selected/slides.length*100)+'%'}document.addEventListener('click',event=>{const el=event.target.closest('.slide h1,.slide h2,.slide h3,.slide p,.slide button,.slide a,.slide [data-od-id]');if(!el)return;const section=el.closest('${selectors}');const index=section?slides.indexOf(section)+1:${slide ?? 1};const label=(el.innerText||el.getAttribute('aria-label')||el.getAttribute('data-od-id')||el.tagName).replace(/\\s+/g,' ').trim().slice(0,140);parent.postMessage({type:'opendesign-target',slide:index,label,tag:el.tagName.toLowerCase()},'*')},true);addEventListener('resize',fit);addEventListener('load',fit);requestAnimationFrame(fit)})();</script>`
    : `<script>document.addEventListener('click',event=>{const el=event.target.closest('h1,h2,h3,p,button,a,[data-od-id]');if(el)parent.postMessage({type:'opendesign-target',slide:1,label:(el.innerText||el.tagName).slice(0,140),tag:el.tagName.toLowerCase()},'*')},true)</script>`
  const hostNavigation = strategy.previewMode === 'slides' ? `<script id="opendesign-host-navigation">document.body.tabIndex=-1;window.focus();document.addEventListener('keydown',event=>{if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true]'))return;const next=['ArrowRight','ArrowDown','PageDown',' '].includes(event.key);const previous=['ArrowLeft','ArrowUp','PageUp'].includes(event.key);if(!next&&!previous)return;event.preventDefault();parent.postMessage({type:'opendesign-navigation',delta:next?1:-1},'*')},true)</script>` : ''
  return html.includes('</head>')
    ? html.replace('</head>', `<style>${theme}</style>${hostStyles}</head>`).replace('</body>', `${hostScript}${hostNavigation}</body>`)
    : `<style>${theme}</style>${hostStyles}${html}${hostScript}${hostNavigation}`
}

async function thumbnailHtml(projectId: string) {
  const project = await getProject(projectId)
  return presentationHtml(projectId, getStrategy(project.strategy).previewMode === 'slides' ? 1 : undefined)
}

function refreshProjectThumbnail(projectId: string) {
  void thumbnailHtml(projectId).then(html => storeThumbnail(projectId, html)).catch(error => console.error('Project thumbnail refresh failed:', error))
}

async function refreshDesignSystemPreviews(systemId: string) {
  const projects = await prisma.project.findMany({ where: { designSystemId: systemId }, select: { id: true } })
  for (const project of projects) {
    invalidateSlideThumbnails(project.id)
    refreshProjectThumbnail(project.id)
  }
}

const slideThumbnailCache = new Map<string, string>()
const slideThumbnailPending = new Map<string, Promise<string>>()
const slideThumbnailVersions = new Map<string, number>()
let slideThumbnailQueue = Promise.resolve()
let slideThumbnailBrowser: Promise<import('playwright').Browser> | undefined

function invalidateSlideThumbnails(projectId: string) {
  slideThumbnailVersions.set(projectId, (slideThumbnailVersions.get(projectId) ?? 0) + 1)
  for (const key of slideThumbnailCache.keys()) if (key.startsWith(`${projectId}:`)) slideThumbnailCache.delete(key)
}

async function renderSlideThumbnail(projectId: string, index: number) {
  const version = slideThumbnailVersions.get(projectId) ?? 0
  const key = `${projectId}:${version}:${index}`
  const cached = slideThumbnailCache.get(key)
  if (cached) return cached
  const pending = slideThumbnailPending.get(key)
  if (pending) return pending

  const task = slideThumbnailQueue.then(async () => {
    const browser = await (slideThumbnailBrowser ??= chromium.launch({ headless: true }))
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 0.5 })
    try {
      await page.setContent(await presentationHtml(projectId, index), { waitUntil: 'networkidle' })
      await page.evaluate(async () => { await document.fonts.ready })
      const stage = page.locator('.stage').first()
      const slide = page.locator('.slide, [data-od-slide]').first()
      const target = await stage.count() ? stage : await slide.count() ? slide : page.locator('body')
      const image = `data:image/png;base64,${(await target.screenshot({ type: 'png', animations: 'disabled' })).toString('base64')}`
      slideThumbnailCache.set(key, image)
      return image
    } finally { await page.close() }
  })
  slideThumbnailQueue = task.then(() => undefined, () => undefined)
  slideThumbnailPending.set(key, task)
  try { return await task }
  finally { slideThumbnailPending.delete(key) }
}

async function systemChoices() {
  const [systems, projects] = await Promise.all([
    getSystems(),
    prisma.project.findMany({ select: { designSystemId: true } }),
  ])
  const projectCounts = new Map<string, number>()
  for (const project of projects) if (project.designSystemId) projectCounts.set(project.designSystemId, (projectCounts.get(project.designSystemId) ?? 0) + 1)
  const nameCounts = new Map<string, number>()
  for (const system of systems) nameCounts.set(system.name, (nameCounts.get(system.name) ?? 0) + 1)
  return systems.map(system => {
    if ((nameCounts.get(system.name) ?? 0) < 2) return { id: system.id, name: system.name }
    const count = projectCounts.get(system.id) ?? 0
    const suffix = count ? `${count} linked project${count === 1 ? '' : 's'}` : 'unlinked copy'
    return { id: system.id, name: `${system.name} · ${suffix}` }
  })
}

async function readSlides(projectId: string) {
  const project = await getProject(projectId)
  if (getStrategy(project.strategy).previewMode !== 'slides') return [{ index: 1, id: project.strategy, title: project.title }]
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
    await page.setContent(await presentationHtml(projectId), { waitUntil: 'networkidle' })
    const items = '.slide, [data-od-slide]'
    const screens = await page.locator(items).evaluateAll(elements => elements.map((element, index) => {
      const title = element.getAttribute('aria-label') || element.querySelector('h1,h2,h3')?.textContent?.trim() || `Screen ${index + 1}`
      return { index: index + 1, id: element.getAttribute('data-od-screen') || element.getAttribute('data-od-slide') || element.id || `screen${index + 1}`, title }
    }))
    if (screens.length) return screens
    const title = await page.title()
    return [{ index: 1, id: 'main', title: title || 'Main screen' }]
  } finally { await browser.close() }
}

async function renderValidation(projectId: string, slide?: number) {
  return inspectPreviewHtml(await presentationHtml(projectId, slide))
}

async function recoverEmptyPreview(projectId: string) {
  const project = await getProject(projectId)
  const currentHtml = project.files.find(file => file.path === 'index.html')?.content ?? ''
  const inspection = await inspectPreviewHtml(await presentationHtml(projectId))
  if (!inspection.empty) return false

  const strategy = getStrategy(project.strategy)
  const fallbackHtml = strategy.starterHtml.replaceAll('Untitled design system', project.title).replaceAll('Untitled deck', project.title)
  if (currentHtml && currentHtml !== fallbackHtml) await writeProjectFile(projectId, 'recovery/empty-preview.html', currentHtml)
  await writeProjectFile(projectId, 'index.html', fallbackHtml)
  await storeThumbnail(projectId, await thumbnailHtml(projectId))
  await addMessage(projectId, 'assistant', 'I detected that the preview had no visible content, so I restored the starter canvas to keep the project usable. The previous source is preserved at recovery/empty-preview.html.')
  return true
}

async function screenshot(projectId: string, slide?: number) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
    await page.setContent(await presentationHtml(projectId, slide), { waitUntil: 'networkidle' })
    return (await page.screenshot({ type: 'png' })).toString('base64')
  } finally { await browser.close() }
}

function activity(job: Job, type: string, text: string, detail?: string, tables: string[] = []) {
  const event: JobEvent = { id: crypto.randomUUID(), type, text, detail, tables, createdAt: new Date().toISOString() }
  job.events.push(event)
  job.eventWrites = job.eventWrites.then(() => prisma.agentRunEvent.create({ data: { runId: job.runId, type, text, detail, tables } }).then(() => undefined)).catch(error => console.error('Agent event persistence failed:', error))
}

function agentTelemetryMiddleware(job: Job): LanguageModelMiddleware {
  const recordUsage = async (usage: { inputTokens: { total: number | undefined }; outputTokens: { total: number | undefined } }) => {
    const inputTokens = usage.inputTokens.total ?? 0
    const outputTokens = usage.outputTokens.total ?? 0
    const totalTokens = inputTokens + outputTokens
    job.usage.inputTokens += inputTokens
    job.usage.outputTokens += outputTokens
    job.usage.totalTokens += totalTokens
    await prisma.agentRun.update({ where: { id: job.runId }, data: { inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens }, totalTokens: { increment: totalTokens } } })
    activity(job, 'tokens', 'Model usage recorded', `${inputTokens.toLocaleString()} input · ${outputTokens.toLocaleString()} output · ${totalTokens.toLocaleString()} total`)
  }
  return {
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      await recordUsage(result.usage)
      return result
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      const stream = result.stream.pipeThrough(new TransformStream({
        async transform(part, controller) {
          if (part.type === 'finish' && part.usage) await recordUsage(part.usage)
          controller.enqueue(part)
        },
      }))
      return { ...result, stream }
    },
  }
}

function authorTools(job: Job, projectId: string, strategyId: string) {
  const strategy = getStrategy(strategyId)
  return {
    listFiles: tool({ description: 'List source files in this project.', inputSchema: z.object({}), execute: async () => { activity(job, 'tool', 'Listed project files', 'SELECT · ProjectFile', ['ProjectFile']); return listProjectFiles(projectId) } }),
    readFile: tool({ description: 'Read a project source file from PostgreSQL.', inputSchema: z.object({ path: z.string() }), execute: async ({ path }) => { const safePath = safeProjectPath(path); activity(job, 'tool', `Read ${safePath}`, 'SELECT · ProjectFile', ['ProjectFile']); return readProjectFile(projectId, safePath) } }),
    writeFile: tool({ description: `Create or replace normal ${strategy.title.toLowerCase()} source code in PostgreSQL.`, inputSchema: z.object({ path: z.string(), content: z.string().min(1) }), execute: async ({ path, content }) => {
      const safePath = safeProjectPath(path)
      const result = await writeProjectFile(projectId, safePath, content)
      if (safePath === 'index.html') {
        invalidateSlideThumbnails(projectId)
        refreshProjectThumbnail(projectId)
      }
      if (strategy.tokenFile === safePath) {
        const data = JSON.parse(content) as { name?: string; tokens?: DesignTokens }
        if (data.tokens?.tokens?.color && data.tokens.tokens.font && data.tokens.tokens.radius) {
          const systemId = (await getProject(projectId)).designSystemId ?? 'acme'
          const tokens = { ...data.tokens, name: data.name ?? data.tokens.name } as DesignTokens
          await saveSystem(systemId, tokens)
          await saveLegacyDesignSystem(systemId, tokens)
          await refreshDesignSystemPreviews(systemId)
        }
      }
      activity(job, 'change', `Updated ${safePath}`, `UPSERT · ProjectFile${safePath === 'index.html' ? ', Project' : ''}${strategy.tokenFile === safePath ? ', DesignSystem' : ''} · ${result.bytes} bytes`, ['ProjectFile', ...(safePath === 'index.html' ? ['Project'] : []), ...(strategy.tokenFile === safePath ? ['DesignSystem'] : [])])
      return result
    }}),
    validatePresentation: tool({ description: 'Render a slide or design project in Chromium and check browser errors, overflow, and whether the preview is empty. Use slide 0 for the whole project.', inputSchema: z.object({ slide: z.number().int().min(0) }), execute: async ({ slide }) => {
      activity(job, slide ? 'review' : 'review', slide ? `Rendered slide ${slide} for validation` : 'Rendered presentation for validation')
      const result = await renderValidation(projectId, slide || undefined)
      activity(job, result.errors.length || result.overflow || result.empty ? 'warning' : 'success', result.errors.length ? `Browser errors: ${result.errors.join('; ')}` : result.empty ? 'The preview is empty; add visible content before finishing.' : result.overflow ? 'Layout exceeds the viewport' : 'Rendering validation passed', JSON.stringify(result.metrics))
      return result
    }}),
    inspectScreenshot: tool({ description: 'Take a screenshot of the rendered project or a specified slide. Inspect it for clipping, overlap, spacing, and alignment. Use slide 0 for the whole project.', inputSchema: z.object({ slide: z.number().int().min(0) }), outputSchema: z.string(), execute: async ({ slide }) => {
      activity(job, 'review', slide ? `Captured visual review of slide ${slide}` : 'Captured visual review of the deck')
      return screenshot(projectId, slide || undefined)
    }, toModelOutput: ({ output }) => ({ type: 'content', value: [{ type: 'file', data: { type: 'data', data: output }, mediaType: 'image/png' }] }) }),
    readDesignSystem: tool({ description: 'Read the tokens linked to this project.', inputSchema: z.object({}), execute: async () => { activity(job, 'tool', 'Read design-system tokens', 'SELECT · DesignSystem', ['DesignSystem']); return (await getSystem((await getProject(projectId)).designSystemId ?? 'acme')).tokens } }),
  }
}

async function runTurn(jobId: string, projectId: string, prompt: string, model: string, slide?: number) {
  const job = jobs.get(jobId)!
  try {
    const project = await getProject(projectId)
    const strategy = getStrategy(project.strategy)
    const beforeHtml = await readProjectFile(projectId, 'index.html').catch(() => strategy.starterHtml)
    const beforeInspection = await inspectPreviewHtml(await presentationHtml(projectId))
    const recoveryHtml = beforeInspection.empty ? strategy.starterHtml : beforeHtml
    activity(job, 'thinking', slide ? `Reviewing your request for slide ${slide}` : `Reviewing your request for ${project.title}`)
    const fileList = await listProjectFiles(projectId)
    activity(job, 'tool', 'Checked the current project files', fileList.join(', ') || 'No source files yet')
    await addMessage(projectId, 'user', prompt)
    const messages = await getProjectMessages(projectId)
    const targetInstruction = slide ? `The user explicitly targeted ${strategy.previewMode === 'slides' ? 'slide' : 'component'} ${slide}. Preserve unrelated content. Current files: ${fileList.join(', ')}.` : `Apply this request to the ${strategy.title.toLowerCase()}.`
    const agentModel = wrapLanguageModel({ model: openrouter(model), middleware: agentTelemetryMiddleware(job) })
    job.liveText = ''
    const result = streamText({
      model: agentModel,
      prompt: `${targetInstruction}\n\nConversation so far:\n${messages.slice(-12).map(message => `${message.role}: ${message.text}`).join('\n')}\n\nCurrent request: ${prompt}`,
      stopWhen: stepCountIs(18),
      instructions: strategy.assistantInstructions,
      tools: authorTools(job, projectId, strategy.id),
      onChunk: ({ chunk }) => { if (chunk.type === 'text-delta') job.liveText += chunk.text },
    })
    let reply = await result.text
    let currentHtml = await readProjectFile(projectId, 'index.html').catch(() => '')
    let inspection = await inspectPreviewHtml(await presentationHtml(projectId))
    if (currentHtml !== beforeHtml && !inspection.empty) {
      activity(job, 'review', 'Captured a screenshot of the updated preview for visual review')
      try {
        const image = await screenshot(projectId)
        job.liveText = ''
        const visualReview = streamText({
          model: agentModel,
          messages: [{ role: 'user', content: [
            { type: 'text', text: `Visually review this rendered ${strategy.title.toLowerCase()} against the user's request: ${prompt}\n\nCheck for clipped, overlapping, or missing content and obvious visual problems. If you find a problem, use the project tools to fix the source. If it looks sound, briefly confirm what you reviewed.` },
            { type: 'image', image: Buffer.from(image, 'base64'), mediaType: 'image/png' },
          ] }],
          instructions: `You are doing a visual QA pass on an OpenDesign project. Inspect the screenshot, read the source if needed, and use writeFile only when a concrete visual issue needs fixing. Keep unrelated content intact.`,
          stopWhen: stepCountIs(8),
          tools: authorTools(job, projectId, strategy.id),
          onChunk: ({ chunk }) => { if (chunk.type === 'text-delta') job.liveText += chunk.text },
        })
        const visualReply = await visualReview.text
        if (visualReply.trim()) {
          job.liveText = visualReply
          reply = visualReply
        }
      } catch (error) {
        activity(job, 'warning', 'Visual screenshot review was unavailable for this model', error instanceof Error ? error.message : String(error))
      }
      currentHtml = await readProjectFile(projectId, 'index.html').catch(() => '')
      inspection = await inspectPreviewHtml(await presentationHtml(projectId))
    }
    reply ||= `Updated ${strategy.title.toLowerCase()}.`
    if (inspection.empty) {
      if (currentHtml && currentHtml !== recoveryHtml) await writeProjectFile(projectId, 'recovery/empty-preview.html', currentHtml)
      await writeProjectFile(projectId, 'index.html', recoveryHtml)
      await storeThumbnail(projectId, await thumbnailHtml(projectId))
      const warning = 'The generated HTML rendered as an empty preview, so I restored the last visible version. The attempted source is saved at recovery/empty-preview.html. Please try the request again or narrow the change.'
      activity(job, 'error', 'Recovered from an empty generated preview', warning)
      reply = warning
    } else if (inspection.errors.length || inspection.overflow) {
      activity(job, 'warning', inspection.errors.length ? `Preview browser errors: ${inspection.errors.join('; ')}` : 'The rendered project exceeds its viewport.', JSON.stringify(inspection.metrics))
    } else if (currentHtml !== beforeHtml) {
      activity(job, 'success', 'Visual review and rendering validation passed', JSON.stringify(inspection.metrics))
    }
    await addMessage(projectId, 'assistant', reply)
    activity(job, 'assistant', reply)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    activity(job, 'error', 'The turn failed', message)
    job.error = message
  } finally {
    await job.eventWrites
    await prisma.agentRun.update({ where: { id: job.runId }, data: { status: job.error ? 'failed' : 'completed', error: job.error ?? null, completedAt: new Date() } }).catch(error => console.error('Agent run completion persistence failed:', error))
    job.done = true
  }
}

const tokenSchema = z.object({
  name: z.string().min(1),
  shadcnCss: z.string().optional(),
  tokens: z.object({
    color: z.object({ ink: z.string(), canvas: z.string(), brand: z.string(), accent: z.string(), muted: z.string() }),
    font: z.object({ display: z.string(), body: z.string() }),
    radius: z.object({ card: z.string() }),
  }),
})
const t = initTRPC.create()
const router = t.router({
  project: t.router({
    list: t.procedure.query(async () => {
      return { projects: await listProjects(), systems: await systemChoices(), strategies: Object.values(projectStrategies).map(({ id, title, description, icon, firstQuestion }) => ({ id, title, description, icon, firstQuestion })) }
    }),
    create: t.procedure.input(z.object({ strategy: z.string(), title: z.string().default(''), brief: z.string().default(''), designSystemId: z.string().default('acme') })).mutation(async ({ input }) => {
      const strategy = getStrategy(input.strategy)
      const project = await createProject(strategy.id, input.title, input.brief, input.designSystemId)
      return { id: project.id }
    }),
    load: t.procedure.input(z.object({ id: z.string(), slide: z.number().int().positive().default(1) })).query(async ({ input }) => {
      const project = await getProject(input.id)
      return {
        project: { id: project.id, title: project.title, description: project.description, strategy: project.strategy, designSystemId: project.designSystemId },
        html: await presentationHtml(input.id, input.slide),
        messages: project.messages.map(message => ({ id: message.id, role: message.role, text: message.text, createdAt: message.createdAt })),
        systems: await systemChoices(),
        storageBytes: project.files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) + project.messages.reduce((sum, message) => sum + Buffer.byteLength(message.text), 0),
        activeSystem: await getSystem(project.designSystemId ?? 'acme'),
      }
    }),
    activity: t.procedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => prisma.agentRun.findMany({ where: { projectId: input.projectId }, orderBy: { startedAt: 'desc' }, take: 25, include: { events: { orderBy: { createdAt: 'asc' } } } })),
    slideThumbnail: t.procedure.input(z.object({ projectId: z.string(), index: z.number().int().positive() })).query(async ({ input }) => ({ image: await renderSlideThumbnail(input.projectId, input.index) })),
    thumbnail: t.procedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
      const project = await getProject(input.projectId)
      return { image: project.thumbnailData ?? await storeThumbnail(project.id, await thumbnailHtml(project.id)) }
    }),
    open: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => { await activateProject(input.id); return { id: input.id } }),
    startTurn: t.procedure.input(z.object({ projectId: z.string(), prompt: z.string().min(1), model: z.string().min(3), slide: z.number().int().positive().optional() })).mutation(async ({ input }) => {
      if (!process.env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY in .env first.')
      await getProject(input.projectId)
      const id = crypto.randomUUID()
      const run = await prisma.agentRun.create({ data: { projectId: input.projectId, model: input.model, prompt: input.prompt } })
      const job: Job = { runId: run.id, projectId: input.projectId, done: false, events: [], liveText: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, eventWrites: Promise.resolve() }
      jobs.set(id, job)
      void withAgentDbTelemetry((table, operation) => activity(job, 'database', `${operation} · ${table}`, undefined, [table]), () => runTurn(id, input.projectId, input.prompt, input.model, input.slide))
      return { id }
    }),
    job: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => {
      const job = jobs.get(input.id)
      if (!job) throw new Error('This conversation turn has expired. Refresh the project and try again.')
      return { done: job.done, error: job.error, events: job.events, liveText: job.liveText, usage: job.usage }
    }),
    selectDesignSystem: t.procedure.input(z.object({ projectId: z.string(), id: z.string() })).mutation(async ({ input }) => { await setProjectSystem(input.projectId, input.id); await refreshDesignSystemPreviews(input.id); return { activeSystem: await getSystem(input.id) } }),
    createDesignSystem: t.procedure.input(z.object({ name: z.string().min(1), projectId: z.string() })).mutation(async ({ input }) => {
      const legacy = await createLegacyDesignSystem(input.name)
      const system = await createSystem(input.name, legacy.id, legacy.tokens)
      await setProjectSystem(input.projectId, legacy.id)
      return system
    }),
    saveDesignSystem: t.procedure.input(z.object({ projectId: z.string(), id: z.string(), tokens: tokenSchema })).mutation(async ({ input }) => {
      const saved = await saveSystem(input.id, input.tokens as DesignTokens)
      await saveLegacyDesignSystem(input.id, input.tokens as DesignTokens)
      await setProjectSystem(input.projectId, input.id)
      await refreshDesignSystemPreviews(input.id)
      return saved
    }),
    importShadcnTheme: t.procedure.input(z.object({ projectId: z.string(), id: z.string(), css: z.string().min(1).max(200_000) })).mutation(async ({ input }) => {
      for (const token of ['--background', '--foreground', '--primary']) if (!input.css.includes(token)) throw new Error(`This CSS does not look like a shadcn theme: missing ${token}.`)
      const current = await getSystem(input.id)
      const tokens = { ...current.tokens, shadcnCss: input.css }
      const saved = await saveSystem(input.id, tokens)
      await saveLegacyDesignSystem(input.id, tokens)
      await setProjectSystem(input.projectId, input.id)
      await refreshDesignSystemPreviews(input.id)
      return saved
    }),
    exportDesignSystem: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => exportDesignSystem(input.id)),
    clearMessages: t.procedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => { await clearProjectMessages(input.projectId); return { ok: true } }),
    setSlide: t.procedure.input(z.object({ projectId: z.string(), index: z.number().int().positive() })).query(async ({ input }) => ({ html: await presentationHtml(input.projectId, input.index) })),
    exportPdf: t.procedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
      const project = await getProject(input.projectId)
      if (!getStrategy(project.strategy).canExportPdf) throw new Error('PDF export is not available for this project type.')
      const html = await presentationHtml(input.projectId)
      const browser = await chromium.launch({ headless: true })
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
        await page.setContent(html, { waitUntil: 'networkidle' })
        await page.addStyleTag({ content: `
          @page { size: 13.333333in 7.5in; margin: 0; }
          html, body { width: 1280px !important; height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; }
          body { display: block !important; }
          .stage { display: block !important; position: relative !important; transform: none !important; scale: 1 !important; width: 1280px !important; height: auto !important; overflow: visible !important; }
          .slide { display: block !important; position: relative !important; inset: auto !important; visibility: visible !important; opacity: 1 !important; transform: none !important; width: 1280px !important; height: 720px !important; page-break-after: always !important; break-after: page !important; transition: none !important; }
          .slide .rise { opacity: 1 !important; transform: none !important; transition: none !important; }
          .slide:last-of-type { page-break-after: auto !important; break-after: auto !important; }
          .stage > .chrome, .stage > .progress { display: none !important; }
        ` })
        const pdf = await page.pdf({ width: '13.333333in', height: '7.5in', printBackground: true, preferCSSPageSize: true })
        if (pdf.byteLength < 1000) throw new Error('Chromium returned an unexpectedly small PDF.')
        return { filename: `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'presentation'}.pdf`, base64: pdf.toString('base64'), bytes: pdf.byteLength, slides: (await readSlides(input.projectId)).length }
      } finally { await browser.close() }
    }),
    delete: t.procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => { await prisma.project.delete({ where: { id: input.id } }); return { ok: true } }),
  }),
})

export type AppRouter = typeof router
const app = new Hono()
app.use('*', cors({ origin: 'http://localhost:5173' }))
app.all('/trpc/*', c => fetchRequestHandler({ endpoint: '/trpc', req: c.req.raw, router, createContext: () => ({}) }))
const port = Number(process.env.PORT ?? 8787)
await initializeDatabase()
const server = serve({ fetch: app.fetch, port }, () => console.log(`tRPC API: http://localhost:${port}/trpc`))
function shutdown() {
  server.close(() => {
    void (async () => {
      const browser = await slideThumbnailBrowser?.catch(() => undefined)
      await browser?.close()
      await prisma.$disconnect()
      process.exit(0)
    })()
  })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
