import { createTRPCProxyClient, httpBatchLink, httpLink } from '@trpc/client'
import JSZip from 'jszip'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AppRouter } from './server'
import { liveThemeCss, synchronizeFoundationTokens, type DesignTokens } from './theme'
import { AsyncValueCache } from './slide-cache'
import './styles.css'

const trpc = createTRPCProxyClient<AppRouter>({ links: [httpBatchLink({ url: 'http://localhost:8787/trpc' })] })
const thumbnailTrpc = createTRPCProxyClient<AppRouter>({ links: [httpLink({ url: 'http://localhost:8787/trpc' })] })
const slideThumbnailCache = new AsyncValueCache<string>()
type Slide = { index: number; id: string; title: string }
type Message = { id: string; role: 'user' | 'assistant'; text: string; createdAt: string }
type Event = { id: string; type: string; text: string; detail?: string; tables?: string[]; createdAt: string }
type Job = { done: boolean; error?: string; events: Event[]; liveText: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }
type AgentRun = { id: string; model: string; prompt: string; status: string; inputTokens: number; outputTokens: number; totalTokens: number; startedAt: string; completedAt: string | null; error: string | null; events: Array<Event & { tables: string[] }> }
type ProjectSummary = { id: string; title: string; description: string; strategy: string; thumbnailData: string | null; active: boolean; createdAt: string; updatedAt: string; sourceBytes: number }
type Strategy = { id: string; title: string; description: string; icon: string; firstQuestion: string }

function loadSlideThumbnail(projectId: string, index: number, themeRevision: number) {
  return slideThumbnailCache.getOrLoad(`${projectId}:${themeRevision}:${index}`, async () =>
    (await thumbnailTrpc.project.slideThumbnail.query({ projectId, index })).image,
  )
}

function App() {
  const [page, setPage] = useState<'home' | 'studio'>('home')
  const [galleryLoading, setGalleryLoading] = useState(true)
  const [projectLoading, setProjectLoading] = useState(false)
  const [model, setModel] = useState('z-ai/glm-5.3-flash')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [creationStrategy, setCreationStrategy] = useState<Strategy | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newBrief, setNewBrief] = useState('')
  const [newDesignSystemId, setNewDesignSystemId] = useState('acme')
  const [projectId, setProjectId] = useState('')
  const [projectTitle, setProjectTitle] = useState('')
  const [strategyId, setStrategyId] = useState('presentation')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [slides, setSlides] = useState<Slide[]>([])
  const [selectedSlide, setSelectedSlide] = useState(1)
  const [selectedElement, setSelectedElement] = useState<{ slide: number; label: string; tag: string } | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [frameReady, setFrameReady] = useState(false)
  const [systems, setSystems] = useState<Array<{ id: string; name: string }>>([])
  const [systemId, setSystemId] = useState('acme')
  const [tokens, setTokens] = useState<DesignTokens | null>(null)
  const [tokensDirty, setTokensDirty] = useState(false)
  const [themeRevision, setThemeRevision] = useState(0)
  const [activity, setActivity] = useState<Event[]>([])
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])
  const [activityTab, setActivityTab] = useState<'conversation' | 'activity'>('conversation')
  const [liveDraft, setLiveDraft] = useState('')
  const [liveUsage, setLiveUsage] = useState({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const [jobId, setJobId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [systemName, setSystemName] = useState('')
  const [savingSystem, setSavingSystem] = useState(false)
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const followChat = useRef(true)
  const tokenRevision = useRef(0)
  const tokenSaveTimer = useRef<number | undefined>(undefined)
  const tokenSaveQueue = useRef<Promise<void>>(Promise.resolve())

  async function loadGallery() {
    setGalleryLoading(true)
    try {
      const result = await trpc.project.list.query()
      setProjects(result.projects as ProjectSummary[])
      setSystems(result.systems)
      setStrategies(result.strategies)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load your projects. Check that Postgres is running.') }
    finally { setGalleryLoading(false) }
  }

  async function loadAgentRuns(id: string) {
    try { setAgentRuns(await trpc.project.activity.query({ projectId: id }) as AgentRun[]) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load agent activity.') }
  }

  async function loadStudio(id: string, slide = selectedSlide, showSkeleton = false) {
    const previousPreview = previewHtml
    setFrameReady(false)
    slideThumbnailCache.invalidate()
    if (showSkeleton) { setPage('studio'); setProjectLoading(true) }
    try {
      const data = await trpc.project.load.query({ id, slide })
      const nextSlides = parseSlides(data.html, data.project.strategy, data.project.title)
      const nextSlide = Math.min(slide, Math.max(nextSlides.length, 1))
      setProjectId(id)
      setProjectTitle(data.project.title)
      setStrategyId(data.project.strategy)
      setMessages(data.messages.map(message => ({ ...message, role: message.role as Message['role'] })))
      setSlides(nextSlides)
      setSelectedSlide(nextSlide)
      setSelectedElement(null)
      setPreviewHtml(data.html)
      setThemeRevision(current => current + 1)
      if (data.html === previousPreview) setFrameReady(true)
      setSystems(data.systems.map(system => ({ id: system.id, name: system.name })))
      setSystemId(data.activeSystem.id)
      setTokens(data.activeSystem.tokens as unknown as DesignTokens)
      tokenRevision.current += 1
      setTokensDirty(false)
      setLiveDraft('')
      setLiveUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
      void loadAgentRuns(id)
      setError('')
      setProjectUrl(id, nextSlide, 'replace')
    } catch (cause) {
      setFrameReady(Boolean(previousPreview))
      if (showSkeleton) setPage('home')
      setError(cause instanceof Error ? cause.message : 'Could not load this project.')
    } finally { if (showSkeleton) setProjectLoading(false) }
  }

  useEffect(() => {
    const navigateFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const id = params.get('project')
      if (id) void loadStudio(id, Math.max(1, Number(params.get('slide')) || 1), true)
      else { setPage('home'); setProjectId(''); void loadGallery() }
    }
    const params = new URLSearchParams(window.location.search)
    const id = params.get('project')
    if (id) void loadStudio(id, Math.max(1, Number(params.get('slide')) || 1), true)
    else void loadGallery()
    window.addEventListener('popstate', navigateFromUrl)
    return () => window.removeEventListener('popstate', navigateFromUrl)
  }, [])
  useEffect(() => {
    if (page !== 'studio' || strategyId !== 'presentation' || !projectId || !slides.length) return
    for (const slide of slides) void loadSlideThumbnail(projectId, slide.index, themeRevision).catch(() => undefined)
  }, [page, projectId, strategyId, slides, themeRevision])
  useEffect(() => {
    const onTarget = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'opendesign-slide-changed') {
        const slide = Number(event.data.slide)
        if (!Number.isInteger(slide) || slide < 1 || slide > slides.length) return
        setSelectedSlide(slide)
        setSelectedElement(null)
        setProjectUrl(projectId, slide, 'replace')
        return
      }
      if (event.data?.type !== 'opendesign-target') return
      setSelectedSlide(event.data.slide)
      setProjectUrl(projectId, event.data.slide, 'replace')
      setSelectedElement({ slide: event.data.slide, label: event.data.label, tag: event.data.tag })
    }
    window.addEventListener('message', onTarget)
    return () => window.removeEventListener('message', onTarget)
  }, [projectId, selectedSlide, slides, strategyId])
  useEffect(() => {
    const onPresentationKey = (event: KeyboardEvent) => {
      if (document.fullscreenElement !== stage.current || strategyId !== 'presentation') return
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return
      const delta = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0
      if (!delta) return
      event.preventDefault()
      const nextIndex = Math.max(1, Math.min(slides.length, selectedSlide + delta))
      if (nextIndex !== selectedSlide) void chooseSlide(slides[nextIndex - 1])
    }
    document.addEventListener('keydown', onPresentationKey, true)
    return () => document.removeEventListener('keydown', onPresentationKey, true)
  }, [selectedSlide, slides, strategyId])
  useEffect(() => {
    const chat = conversation.current
    if (chat && followChat.current) chat.scrollTop = chat.scrollHeight
  }, [messages, activity, liveDraft, liveUsage, busy])
  useEffect(() => {
    if (!tokens) return
    frame.current?.contentWindow?.postMessage({ type: 'opendesign-theme', css: liveThemeCss(tokens) }, '*')
  }, [tokens, previewHtml])
  useEffect(() => {
    if (!tokens || !tokensDirty || !projectId) return
    const snapshot = tokens
    const revision = tokenRevision.current
    const id = systemId
    tokenSaveTimer.current = window.setTimeout(() => {
      void persistTokenSnapshot(id, snapshot, revision).catch(cause => {
        if (revision === tokenRevision.current) setError(cause instanceof Error ? cause.message : 'Could not save the design system.')
      })
    }, 600)
    return () => window.clearTimeout(tokenSaveTimer.current)
  }, [tokens, tokensDirty, projectId, systemId])

  useEffect(() => {
    if (!jobId || !busy) return
    let live = true
    const poll = async () => {
      try {
        const result = await trpc.project.job.query({ id: jobId }) as Job
        if (!live) return
        setActivity(result.events)
        setLiveDraft(result.liveText)
        setLiveUsage(result.usage)
        if (result.done) {
          setBusy(false)
          if (result.error) setError(result.error)
          await loadStudio(projectId)
          void loadAgentRuns(projectId)
        }
      } catch (cause) {
        if (!live) return
        setBusy(false)
        setError(cause instanceof Error ? cause.message : 'Could not read agent activity.')
      }
    }
    void poll()
    const timer = window.setInterval(poll, 650)
    return () => { live = false; window.clearInterval(timer) }
  }, [jobId, busy])

  async function createFromStrategy(event: React.FormEvent) {
    event.preventDefault()
    if (!creationStrategy) return
    try {
      const created = await trpc.project.create.mutate({ strategy: creationStrategy.id, title: newTitle, brief: newBrief, designSystemId: newDesignSystemId })
      const brief = newBrief.trim()
      setCreationStrategy(null); setNewTitle(''); setNewBrief('')
      setProjectUrl(created.id, 1, 'push')
      await loadStudio(created.id, 1, true)
      if (brief) await startTurn(brief, created.id)
      void loadGallery()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the project.') }
  }

  async function openProject(project: ProjectSummary) {
    setProjectUrl(project.id, 1, 'push')
    setPage('studio'); setProjectLoading(true)
    try { await trpc.project.open.mutate({ id: project.id }); await loadStudio(project.id, 1, true) }
    catch (cause) { setPage('home'); setProjectLoading(false); setError(cause instanceof Error ? cause.message : 'Could not open the project.') }
  }

  async function deleteProject(project: ProjectSummary) {
    setOpenProjectMenuId(null)
    const confirmed = window.confirm(`Delete “${project.title}”? Its source files and conversation will be permanently removed. Any linked design system will remain available.`)
    if (!confirmed) return
    try {
      await trpc.project.delete.mutate({ id: project.id })
      setProjects(current => current.filter(item => item.id !== project.id))
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this project.') }
  }

  async function startTurn(text: string, id = projectId, targetSlide?: number) {
    if (!text.trim() || busy || !id) return
    followChat.current = true
    setBusy(true); setError(''); setActivity([]); setSelectedElement(null)
    try {
      const result = await trpc.project.startTurn.mutate({ projectId: id, prompt: text, model, ...(targetSlide ? { slide: targetSlide } : {}) })
      setJobId(result.id)
      setLiveDraft('')
      setLiveUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
      void loadAgentRuns(id)
      setMessages(current => [...current, { id: `pending-${result.id}`, role: 'user', text, createdAt: new Date().toISOString() }])
    } catch (cause) { setBusy(false); setError(cause instanceof Error ? cause.message : 'Could not start the agent turn.') }
  }

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    const token = strategyId === 'presentation' ? 'slide' : 'component'
    const selectedReference = selectedElement && !/@(?:slide|screen|component)[-_ ]?\d+/i.test(text)
      ? `@${token}${selectedElement.slide} #${selectedElement.tag} “${selectedElement.label}”\n`
      : ''
    const request = `${selectedReference}${text}`
    const match = request.match(/@(?:slide|screen|component)[-_ ]?(\d+)/i)
    setPrompt('')
    await startTurn(request, projectId, match ? Number(match[1]) : undefined)
  }

  function chooseSlide(slide: Slide) {
    setSelectedSlide(slide.index); setSelectedElement(null)
    setProjectUrl(projectId, slide.index, 'replace')
    frame.current?.contentWindow?.postMessage({ type: 'opendesign-select-slide', index: slide.index }, '*')
  }

  function targetSlide() {
    const token = strategyId === 'presentation' ? 'slide' : 'component'
    const ref = selectedElement?.slide === selectedSlide
      ? `@${token}${selectedSlide} #${selectedElement.tag} “${selectedElement.label}”`
      : `@${token}${selectedSlide}`
    setPrompt(current => current.includes(ref) ? current : `${ref} ${current}`.trim())
  }

  async function exportPdf() {
    setBusy(true); setError('')
    try {
      const { base64, filename } = await trpc.project.exportPdf.mutate({ projectId })
      const binary = atob(base64); const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF export failed.') }
    finally { setBusy(false) }
  }

  async function saveTokens() {
    if (!tokens) return
    window.clearTimeout(tokenSaveTimer.current)
    try {
      const revision = tokenRevision.current
      await persistTokenSnapshot(systemId, tokens, revision)
      setActivity([{ id: crypto.randomUUID(), type: 'success', text: `Saved ${tokens.name}`, detail: 'Token JSON, theme CSS, and Tailwind preset were updated.', createdAt: new Date().toISOString() }])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the design system.') }
  }

  async function persistTokenSnapshot(id: string, snapshot: DesignTokens, revision: number) {
    setSavingSystem(true)
    const save = tokenSaveQueue.current.catch(() => undefined).then(async () => {
      await trpc.project.saveDesignSystem.mutate({ projectId, id, tokens: snapshot })
      if (revision === tokenRevision.current) {
        setTokensDirty(false)
        slideThumbnailCache.invalidate()
        setThemeRevision(current => current + 1)
      }
    })
    tokenSaveQueue.current = save.then(() => undefined, () => undefined)
    try { await save }
    finally { setSavingSystem(false) }
  }

  function editTokens(update: (current: DesignTokens) => DesignTokens) {
    tokenRevision.current += 1
    setTokens(current => current ? synchronizeFoundationTokens(update(current)) : current)
    setTokensDirty(true)
  }

  async function createSystem() {
    if (!systemName.trim()) return
    try {
      const created = await trpc.project.createDesignSystem.mutate({ name: systemName.trim(), projectId })
      setSystemName(''); await loadStudio(projectId)
      setActivity([{ id: crypto.randomUUID(), type: 'success', text: `Created ${created.tokens.name}`, detail: 'This system is attached to the current project and reusable elsewhere.', createdAt: new Date().toISOString() }])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the design system.') }
  }

  async function changeSystem(id: string) {
    try {
      window.clearTimeout(tokenSaveTimer.current)
      if (tokens && tokensDirty) await persistTokenSnapshot(systemId, tokens, tokenRevision.current)
      await trpc.project.selectDesignSystem.mutate({ projectId, id }); await loadStudio(projectId)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not switch design system.') }
  }

  async function downloadSystem() {
    try {
      const bundle = await trpc.project.exportDesignSystem.query({ id: systemId })
      const zip = new JSZip()
      zip.file('manifest.json', bundle.manifest); zip.file('tokens.json', bundle.tokens); zip.file('theme.css', bundle.theme); zip.file('tailwind.preset.ts', bundle.preset)
      const blob = await zip.generateAsync({ type: 'blob' }); const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${systemId}-design-system.zip`; document.body.appendChild(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export the design system.') }
  }

  function importShadcnTheme() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.css,text/css'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const css = await file.text()
        await trpc.project.importShadcnTheme.mutate({ projectId, id: systemId, css })
        await loadStudio(projectId)
        setActivity([{ id: crypto.randomUUID(), type: 'success', text: `Imported ${file.name}`, detail: 'The shadcn theme is saved with this design system and applied to its preview.', createdAt: new Date().toISOString() }])
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import that shadcn theme.') }
    }
    input.click()
  }

  async function clearConversation() {
    await trpc.project.clearMessages.mutate({ projectId }); setMessages([]); setActivity([])
  }

  async function present() {
    try {
      if (!frameReady || !slides.length) return
      const presentationStage = stage.current
      if (!presentationStage) return
      await presentationStage.requestFullscreen()
      presentationStage.focus()
      frame.current?.contentWindow?.focus()
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not enter presentation mode.') }
  }

  const colorFields: Array<[keyof DesignTokens['tokens']['color'], string]> = [['ink', 'Ink'], ['canvas', 'Canvas'], ['brand', 'Brand'], ['accent', 'Accent'], ['muted', 'Muted']]
  const strategy = strategies.find(item => item.id === strategyId)

  if (page === 'home') return <div className="studio home-shell">
    <header className="topbar home-topbar"><div className="home-tools"><input className="model-input" aria-label="OpenRouter model ID" value={model} onChange={event => setModel(event.target.value)} /></div></header>
    <main className="home-content">
      <div className="home-title"><div><span className="overline">YOUR CREATIVE WORKSPACE</span><h1>Design</h1></div></div>
      <section className="create-section"><h2>Make something new</h2><div className="strategy-grid">{galleryLoading && !strategies.length ? Array.from({ length: 2 }, (_, index) => <div className="strategy-skeleton" key={index}><span className="skeleton-block"/><span className="skeleton-line"/><span className="skeleton-line short"/></div>) : strategies.map(item => <button className="strategy-card" key={item.id} onClick={() => { setCreationStrategy(item); setNewTitle(''); setNewBrief(''); setNewDesignSystemId(systemId) }}><span className={`strategy-art ${item.id}`}>{item.id === 'presentation' ? <span className="art-slide"><i/><i/><b/></span> : <span className="art-system"><i/><i/><i/><b/></span>}</span><strong>{item.title}<em>New</em></strong><small>{item.description}</small></button>)}</div></section>
      <section className="projects-section"><div className="section-title"><h2>Recent projects</h2><span>{projects.length} projects</span></div>
        {error && <div className="error-card"><strong>Needs attention</strong><p>{error}</p><button onClick={() => setError('')}>Dismiss</button></div>}
        {galleryLoading && !projects.length ? <div className="project-grid">{Array.from({ length: 3 }, (_, index) => <div className="project-skeleton" key={index}><div className="skeleton-block"/><div className="skeleton-line"/><div className="skeleton-line short"/></div>)}</div> : projects.length ? <div className="project-grid">{projects.map(project => <article className="project-card" key={project.id}>
          <button className="project-open" onClick={() => void openProject(project)} aria-label={`Open ${project.title}`}><ProjectThumbnail project={project} /><div className="project-meta"><strong>{project.title}</strong><small>{project.strategy === 'presentation' ? '▥' : '◉'} {new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} <span>·</span> {formatSize(project.sourceBytes)}</small></div></button>
          <div className="project-actions"><button className="project-more" title="Project actions" aria-label={`Actions for ${project.title}`} aria-haspopup="menu" aria-expanded={openProjectMenuId === project.id} onClick={() => setOpenProjectMenuId(current => current === project.id ? null : project.id)}>···</button>{openProjectMenuId === project.id && <div className="project-menu" role="menu"><button role="menuitem" onClick={() => void deleteProject(project)}>Delete project</button></div>}</div>
        </article>)}</div> : <div className="empty-projects">Your designs will live here. Start with a presentation or design system above.</div>}
      </section>
    </main>
    {creationStrategy && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreationStrategy(null) }}><form className="create-modal" onSubmit={event => void createFromStrategy(event)}><button type="button" className="modal-close" onClick={() => setCreationStrategy(null)}>×</button><span className="strategy-modal-icon">{creationStrategy.icon}</span><span className="overline">NEW {creationStrategy.title.toUpperCase()}</span><h2>Let's get the direction right.</h2><label>Project name<input value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder={creationStrategy.id === 'presentation' ? 'Q4 product launch' : 'Northstar design system'} /></label>{creationStrategy.id === 'presentation' && <label>Start from a design system<Dropdown value={newDesignSystemId} options={systems} ariaLabel="Start from a design system" onChange={setNewDesignSystemId} /></label>}<label>{creationStrategy.id === 'design-system' ? 'What are you designing this system for?' : 'What do you want to communicate?'}<textarea autoFocus rows={5} value={newBrief} onChange={event => setNewBrief(event.target.value)} placeholder={creationStrategy.firstQuestion} /></label><p>The design partner will ask follow-ups, explore options, and build the first draft.</p><button className="button primary" disabled={!newBrief.trim()}>Start creating <span>→</span></button></form></div>}
  </div>

  if (projectLoading) return <ProjectLoadingSkeleton />

  return <div className="studio editor-shell">
    <header className="topbar editor-topbar"><div className="project-breadcrumb"><button className="breadcrumb-home" onClick={() => { setProjectUrl('', 1, 'push'); setPage('home'); setProjectId(''); void loadGallery() }}>DESIGN</button><b>/</b><strong>{projectTitle}</strong><em>{strategy?.title ?? strategyId}</em></div><div className="top-actions"><input className="model-input" aria-label="OpenRouter model ID" value={model} onChange={event => setModel(event.target.value)} /><button className="button quiet" onClick={() => void loadStudio(projectId)}>Reload</button>{strategyId === 'presentation' && <button className="button quiet" disabled={!slides.length || !frameReady || busy} onClick={() => void present()}>{frameReady ? 'Present ↗' : 'Loading deck…'}</button>}{strategyId === 'presentation' && <button className="button primary" disabled={!slides.length || busy} onClick={() => void exportPdf()}>Export PDF</button>}</div></header>
    <main className="editor-layout">
      <aside className="assistant-panel left-panel">
        <div className="assistant-head">
          <div><span className="overline">DESIGN PARTNER</span><div className="assistant-tabs" role="tablist" aria-label="Design partner panels">
            <button role="tab" aria-selected={activityTab === 'conversation'} onClick={() => setActivityTab('conversation')}>Conversation</button>
            <button role="tab" aria-selected={activityTab === 'activity'} onClick={() => setActivityTab('activity')}>Activity</button>
          </div></div>
          {activityTab === 'conversation' && <button className="icon-button" title="Clear conversation" onClick={() => void clearConversation()}>＋</button>}
        </div>
        {activityTab === 'conversation' ? <>
          <div className="conversation" ref={conversation} onScroll={event => {
            const chat = event.currentTarget
            followChat.current = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48
          }}>
            <div className="welcome-card"><span className="assistant-orb">✳</span><div><strong>{strategyId === 'design-system' ? 'Let’s build your visual language.' : 'What should we work on?'}</strong><p>{strategyId === 'presentation' ? 'Discuss the narrative or target any slide/element from the preview.' : 'Tell me where the system will be used. We can explore variants together before settling on foundations and components.'}</p></div></div>
            {messages.map(message => <article key={message.id} className={`message ${message.role}`}><span>{message.role === 'user' ? 'YOU' : 'OPENDESIGN'}</span>{message.role === 'assistant' ? <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown></div> : <p>{message.text}</p>}</article>)}
            {busy && liveDraft && <article className="message assistant streaming-message"><span>OPENDESIGN · RESPONDING</span><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{liveDraft}</ReactMarkdown></div></article>}
            {busy && <div className="live-run-meter"><span>LIVE USAGE</span><strong>{liveUsage.totalTokens.toLocaleString()} tokens</strong><small>{liveUsage.inputTokens.toLocaleString()} in · {liveUsage.outputTokens.toLocaleString()} out</small></div>}
            {activity.length > 0 && <section className="activity"><div className="activity-title"><span className={busy ? 'pulse' : ''}/>{busy ? 'WORKING' : 'LATEST ACTIVITY'}</div>{activity.map(item => <article key={item.id} className={`activity-item ${item.type}`}><span className="activity-marker">{item.type === 'change' ? '↗' : item.type === 'success' ? '✓' : item.type === 'error' || item.type === 'warning' ? '!' : item.type === 'thinking' ? '✳' : '·'}</span><div><strong>{item.text}</strong>{item.detail && <small>{item.detail}</small>}</div></article>)}{busy && <div className="agent-progress"><span/><span/><span/></div>}</section>}
            {error && <div className="error-card"><strong>Needs attention</strong><p>{error}</p><button onClick={() => setError('')}>Dismiss</button></div>}
          </div>
          <form className="composer" onSubmit={event => void sendMessage(event)}>
            <div className="composer-target"><button type="button" onClick={targetSlide}>@{strategyId === 'presentation' ? 'slide' : 'component'}{selectedSlide}{selectedElement?.slide === selectedSlide ? ` · ${selectedElement.tag.toUpperCase()}` : ''}</button><span>{selectedElement?.slide === selectedSlide ? `“${selectedElement.label}” selected` : 'Click preview content to target it'}</span></div>
            <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={strategyId === 'presentation' ? 'Ask for a change… Try @slide2 make the headline bolder' : 'Explore a calmer palette and a more editorial type system…'} rows={3} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} />
            <div className="composer-bottom"><span>{busy ? 'Working…' : 'Enter to send · Shift + Enter for new line'}</span><button type="submit" className="send-button" disabled={busy || !prompt.trim()}>{busy ? '…' : '↑'}</button></div>
          </form>
        </> : <AgentActivityPanel runs={agentRuns} events={activity} liveUsage={liveUsage} busy={busy}/>}
      </aside>
      <section className="canvas"><div className="canvas-head"><div><span className="overline">{strategy?.title.toUpperCase() ?? 'PROJECT'}</span><strong>{slides.find(slide => slide.index === selectedSlide)?.title ?? projectTitle}</strong></div><div className="canvas-tools">{strategyId === 'presentation' && <><button onClick={() => void chooseSlide(slides[Math.max(0, selectedSlide - 2)] ?? slides[0])} disabled={selectedSlide <= 1}>←</button><span>{String(selectedSlide).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span><button onClick={() => void chooseSlide(slides[Math.min(slides.length - 1, selectedSlide)] ?? slides[0])} disabled={selectedSlide >= slides.length}>→</button></>}</div></div><div ref={stage} className="stage-wrap" tabIndex={-1} aria-busy={!frameReady}>{previewHtml ? <iframe ref={frame} title={`${projectTitle} preview`} sandbox="allow-scripts" srcDoc={previewHtml} onLoad={() => { if (tokens) frame.current?.contentWindow?.postMessage({ type: 'opendesign-theme', css: liveThemeCss(tokens) }, '*'); setFrameReady(true) }} /> : <div className="preview-skeleton" aria-label="Loading slide preview"><span/><span/><span/></div>}</div><div className="canvas-foot"><span><b className="live-dot"/> Live preview</span><span>{strategyId === 'presentation' ? '16:9 · Source stored in PostgreSQL' : 'HTML/CSS/JS · Source stored in PostgreSQL'}</span></div></section>
      <aside className="inspector-panel"><div className="inspector-head"><span className="overline">FOUNDATIONS</span><h2>{strategyId === 'design-system' ? 'System in progress' : 'Design system'}</h2><p>{strategyId === 'design-system' ? 'Explore component directions in the preview; save a reusable system when it is ready.' : 'The active system shapes this project and can be reused elsewhere.'}</p></div>{tokens && <div className="system-controls"><label>Active system<Dropdown value={systemId} options={systems} ariaLabel="Active design system" onChange={id => void changeSystem(id)} /></label><label>System name<input value={tokens.name} onChange={event => editTokens(current => ({ ...current, name: event.target.value }))} /></label><div className="color-grid">{colorFields.map(([key, label]) => <label key={key} className="color-field"><span>{label}</span><input type="color" value={tokens.tokens.color[key]} onChange={event => editTokens(current => ({ ...current, tokens: { ...current.tokens, color: { ...current.tokens.color, [key]: event.target.value } } }))} /></label>)}</div><label>Display font<input value={tokens.tokens.font.display} onChange={event => editTokens(current => ({ ...current, tokens: { ...current.tokens, font: { ...current.tokens.font, display: event.target.value } } }))} /></label><label>Body font<input value={tokens.tokens.font.body} onChange={event => editTokens(current => ({ ...current, tokens: { ...current.tokens, font: { ...current.tokens.font, body: event.target.value } } }))} /></label><button className="button primary full" onClick={() => void saveTokens()} disabled={savingSystem}>{savingSystem ? 'Saving…' : 'Save & use system'}</button><small className="system-save-status" aria-live="polite">{savingSystem ? 'Saving changes…' : tokensDirty ? 'Changes pending…' : 'Changes save automatically'}</small><button className="button quiet full" onClick={importShadcnTheme}>Load shadcn globals.css</button><button className="button quiet full" onClick={() => void downloadSystem()}>Download shadcn theme bundle</button><div className="new-system"><input placeholder="New system name" value={systemName} onChange={event => setSystemName(event.target.value)} /><button className="button quiet" onClick={() => void createSystem()}>＋</button></div></div>}<div className="inspector-storage"><span>PROJECT STORAGE</span><strong>{formatSize((previewHtml.length || 0) + messages.reduce((sum, message) => sum + message.text.length, 0))}</strong><small>Saved automatically to Postgres</small></div></aside>
      <nav className="filmstrip"><div className="filmstrip-title"><span>{strategyId === 'presentation' ? 'SLIDES' : 'ARTBOARD'}</span><span>{strategyId === 'presentation' ? `${String(slides.length).padStart(2, '0')} TOTAL` : 'LIVE PREVIEW'}</span></div><div className="filmstrip-items">{slides.map(slide => <button key={slide.id} className={`film-card ${selectedSlide === slide.index ? 'selected' : ''}`} onClick={() => void chooseSlide(slide)} aria-label={`Show slide ${slide.index}: ${slide.title}`}><SlideThumbnail key={`${projectId}:${slide.index}:${themeRevision}`} projectId={projectId} slide={slide} selected={selectedSlide === slide.index} themeRevision={themeRevision} /><small>{slide.title}</small></button>)}</div></nav>
    </main>
  </div>
}

function AgentActivityPanel({ runs, events, liveUsage, busy }: { runs: AgentRun[]; events: Event[]; liveUsage: { inputTokens: number; outputTokens: number; totalTokens: number }; busy: boolean }) {
  const completedUsage = runs.reduce((total, run) => ({ input: total.input + run.inputTokens, output: total.output + run.outputTokens, all: total.all + run.totalTokens }), { input: 0, output: 0, all: 0 })
  const tables = new Map<string, number>()
  for (const run of runs) for (const event of run.events) for (const table of event.tables) tables.set(table, (tables.get(table) ?? 0) + 1)
  for (const event of events) for (const table of event.tables ?? []) tables.set(table, (tables.get(table) ?? 0) + 1)
  return <div className="agent-activity-view">
    <section className="telemetry-summary">
      <div className="telemetry-heading"><div><span className="overline">AGENT MIDDLEWARE</span><strong>{busy ? 'Run in progress' : 'Usage & database activity'}</strong></div><span className={busy ? 'run-status running' : 'run-status'}>{busy ? 'LIVE' : `${runs.length} RUNS`}</span></div>
      <div className="token-summary"><div><span>Input tokens</span><strong>{(completedUsage.input + (busy ? liveUsage.inputTokens : 0)).toLocaleString()}</strong></div><div><span>Output tokens</span><strong>{(completedUsage.output + (busy ? liveUsage.outputTokens : 0)).toLocaleString()}</strong></div><div><span>Total tokens</span><strong>{(completedUsage.all + (busy ? liveUsage.totalTokens : 0)).toLocaleString()}</strong></div></div>
      <div className="database-summary"><span>DATABASE TABLES TOUCHED · QUERY COUNT</span>{tables.size ? <div>{[...tables].map(([table, count]) => <span className="table-chip" key={table}>{table}<b>{count}</b></span>)}</div> : <small>No agent database operations recorded yet.</small>}</div>
    </section>
    {busy && events.length > 0 && <section className="run-events"><h3>Current run</h3>{events.map(event => <ActivityEvent key={event.id} event={event}/>)}</section>}
    <section className="run-history"><h3>Recent agent runs</h3>{runs.length ? runs.map(run => <article className="run-card" key={run.id}>
      <header><div><strong>{run.model}</strong><small>{new Date(run.startedAt).toLocaleString()}</small></div><span className={`run-status ${run.status}`}>{run.status}</span></header>
      <p>{run.prompt}</p><div className="run-token-line">{run.inputTokens.toLocaleString()} input · {run.outputTokens.toLocaleString()} output · <b>{run.totalTokens.toLocaleString()} tokens</b></div>
      {run.events.some(event => event.tables.length) && <div className="run-tables">{[...new Set(run.events.flatMap(event => event.tables))].map(table => <span className="table-chip" key={table}>{table}</span>)}</div>}
      <details><summary>{run.events.length} agent events</summary><div>{run.events.map(event => <ActivityEvent key={event.id} event={event}/>)}</div></details>
      {run.error && <p className="run-error">{run.error}</p>}
    </article>) : <p className="no-runs">Agent runs and their token/database usage will appear here.</p>}</section>
  </div>
}

function ActivityEvent({ event }: { event: Event & { tables?: string[] } }) {
  return <article className="activity-item"><span className="activity-marker">{event.type === 'change' ? '↗' : event.type === 'tokens' ? '#' : event.type === 'error' ? '!' : '·'}</span><div><strong>{event.text}</strong>{event.detail && <small>{event.detail}</small>}{event.tables?.length ? <small className="event-tables">Tables: {event.tables.join(', ')}</small> : null}</div></article>
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function parseSlides(html: string, strategy: string, projectTitle: string): Slide[] {
  if (strategy !== 'presentation') return [{ index: 1, id: strategy, title: projectTitle }]
  const document = new DOMParser().parseFromString(html, 'text/html')
  const slides = [...document.querySelectorAll('.slide, [data-od-slide]')]
  return slides.length ? slides.map((element, index) => ({
    index: index + 1,
    id: element.getAttribute('data-od-screen') || element.getAttribute('data-od-slide') || element.id || `slide${index + 1}`,
    title: element.getAttribute('aria-label') || element.querySelector('h1,h2,h3')?.textContent?.trim() || `Slide ${index + 1}`,
  })) : [{ index: 1, id: 'main', title: projectTitle }]
}

function setProjectUrl(projectId: string, slide: number, mode: 'push' | 'replace') {
  const url = new URL(window.location.href)
  if (projectId) {
    url.searchParams.set('project', projectId)
    url.searchParams.set('slide', String(slide))
  } else {
    url.searchParams.delete('project')
    url.searchParams.delete('slide')
  }
  window.history[mode === 'push' ? 'pushState' : 'replaceState']({}, '', url)
}

type SystemOption = { id: string; name: string }

function Dropdown({ value, options, ariaLabel, onChange }: { value: string; options: SystemOption[]; ariaLabel: string; onChange(value: string): void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = options.find(option => option.id === value)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  return <div className="select-menu" ref={root}>
    <button type="button" className="select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <span>{selected?.name ?? 'Choose a design system'}</span><span className="select-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="select-options" role="listbox" aria-label={ariaLabel}>{options.map(option => <button type="button" role="option" aria-selected={option.id === value} className={option.id === value ? 'selected' : ''} key={option.id} onClick={() => { onChange(option.id); setOpen(false) }}><span>{option.name}</span>{option.id === value && <span aria-hidden="true">✓</span>}</button>)}</div>}
  </div>
}

function ProjectThumbnail({ project }: { project: ProjectSummary }) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [image, setImage] = useState(project.thumbnailData ?? '')
  useEffect(() => { if (project.thumbnailData) setImage(project.thumbnailData) }, [project.thumbnailData])
  useEffect(() => {
    if (image || !root.current) return
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '100px' })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [image])
  useEffect(() => {
    if (!visible || image) return
    let live = true
    void trpc.project.thumbnail.query({ projectId: project.id }).then(result => { if (live) setImage(result.image) }).catch(() => undefined)
    return () => { live = false }
  }, [visible, image, project.id])
  return <div className="project-thumb" ref={root}>
    {image ? <img src={image} alt="" loading="lazy" /> : <div className="thumb-placeholder"><span className="thumbnail-skeleton"/></div>}
    <span>{project.strategy === 'presentation' ? 'Presentation' : project.strategy === 'design-system' ? 'Design system' : project.strategy}</span>
  </div>
}

function SlideThumbnail({ projectId, slide, selected, themeRevision }: { projectId: string; slide: Slide; selected: boolean; themeRevision: number }) {
  const key = `${projectId}:${themeRevision}:${slide.index}`
  const [image, setImage] = useState(() => slideThumbnailCache.get(key) ?? '')
  useEffect(() => {
    let live = true
    const cached = slideThumbnailCache.get(key)
    if (cached) { setImage(cached); return () => { live = false } }
    setImage('')
    void loadSlideThumbnail(projectId, slide.index, themeRevision).then(result => { if (live) setImage(result) }).catch(() => undefined)
    return () => { live = false }
  }, [key, projectId, slide.index, themeRevision])
  return <span className={`film-thumbnail ${image ? 'loaded' : 'loading'} ${selected ? 'current' : ''}`}>
    {image ? <img src={image} alt={`Slide ${slide.index}: ${slide.title}`} loading="lazy" /> : <span className="thumbnail-skeleton" aria-label={`Loading slide ${slide.index} thumbnail`} />}
    <span className="film-number">{String(slide.index).padStart(2, '0')}</span>
  </span>
}

function ProjectLoadingSkeleton() {
  return <div className="studio editor-shell loading-shell" aria-label="Opening project">
    <header className="topbar editor-topbar"><span className="skeleton-line short"/><span className="skeleton-line wide"/></header>
    <main className="editor-layout">
      <aside className="assistant-panel loading-panel"><span className="skeleton-line short"/><span className="skeleton-block"/><span className="skeleton-block"/></aside>
      <section className="canvas loading-canvas"><span className="skeleton-line short"/><div className="preview-skeleton"><span/><span/><span/></div></section>
      <aside className="inspector-panel loading-panel"><span className="skeleton-line short"/><span className="skeleton-block"/><span className="skeleton-block"/><span className="skeleton-block"/></aside>
      <nav className="filmstrip loading-filmstrip"><div className="filmstrip-items">{Array.from({ length: 6 }, (_, index) => <span className="thumbnail-skeleton" key={index}/>)}</div></nav>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
