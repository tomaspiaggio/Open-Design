import { starterDeck } from './workspace.js'

export type StrategyId = 'presentation' | 'design-system'

export type ProjectStrategy = {
  id: StrategyId
  title: string
  description: string
  icon: string
  starterTitle: string
  starterHtml: string
  assistantInstructions: string
  firstQuestion: string
  previewMode: 'slides' | 'canvas'
  canExportPdf: boolean
  tokenFile: string | null
  cloneDesignSystem: boolean
  createFiles(title: string, baseTokens?: unknown): Array<{ path: string; content: string }>
}

export const projectStrategies: Record<StrategyId, ProjectStrategy> = {
  presentation: {
    id: 'presentation',
    title: 'Presentation',
    description: 'Build a story, one polished slide at a time.',
    icon: '▤',
    starterTitle: 'Untitled presentation',
    starterHtml: starterDeck,
    previewMode: 'slides',
    canExportPdf: true,
    tokenFile: null,
    cloneDesignSystem: false,
    createFiles: title => [{ path: 'index.html', content: starterDeck.replaceAll('Untitled deck', title) }],
    firstQuestion: 'What is this presentation about, who is it for, and what should they remember?',
    assistantInstructions: `You are OpenDesign's presentation strategist. Create and revise a complete, polished HTML presentation with ordinary HTML/CSS/JavaScript. The source is the artifact. Keep each slide readable at 16:9, use section.slide elements, and use active design-system tokens. Read the project files first. Preserve unrelated slides on targeted edits. Render screenshots and validate every changed slide before reporting back.`,
  },
  'design-system': {
    id: 'design-system',
    title: 'Design system',
    description: 'Explore visual directions and create a reusable component library.',
    icon: '◈',
    starterTitle: 'Untitled design system',
    starterHtml: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Untitled design system</title><style>
      *{box-sizing:border-box}body{margin:0;padding:52px;background:var(--od-canvas,#f8fafc);color:var(--od-ink,#111827);font:15px/1.5 var(--od-font-body,system-ui,sans-serif)}main{max-width:1100px;margin:auto}h1,h2{font-family:var(--od-font-display,system-ui,sans-serif);letter-spacing:-.04em}h1{font-size:52px;margin:0}header p{color:var(--od-muted,#6b7280)}section{margin-top:38px}h2{font-size:22px}.swatches{display:flex;gap:12px}.swatch{width:125px;padding:10px;border:1px solid #d8dce3;border-radius:12px;background:white}.color{height:65px;border-radius:7px;background:var(--od-brand,#6559ef)}.color:nth-child(2){background:var(--od-accent,#f18432)}.color:nth-child(3){background:var(--od-ink,#14161a)}button{padding:11px 18px;border:0;border-radius:9px;background:var(--od-brand,#6559ef);color:white;font:inherit}button.secondary{border:1px solid #d8dce3;background:white;color:var(--od-ink,#14161a)}.buttons{display:flex;gap:10px}.card{max-width:420px;padding:20px;border:1px solid #d8dce3;border-radius:14px;background:white}
    </style></head><body><main><header><p>DESIGN SYSTEM · DRAFT</p><h1>Let's shape your visual language.</h1><p>Tell me what you're making. I'll explore a few visual directions, then build the core components and tokens with you.</p></header><section><h2>Color directions</h2><div class="swatches"><div class="swatch"><div class="color"></div><small>Brand</small></div><div class="swatch"><div class="color" style="background:var(--od-accent,#f18432)"></div><small>Accent</small></div><div class="swatch"><div class="color" style="background:var(--od-ink,#14161a)"></div><small>Ink</small></div></div></section><section><h2>Button explorations</h2><div class="buttons"><button>Primary action</button><button class="secondary">Secondary action</button></div></section><section><h2>Component preview</h2><div class="card"><strong>Sample component</strong><p>A starting point. Describe the brand, product, and audience to begin exploring.</p></div></section></main></body></html>`,
    previewMode: 'canvas',
    canExportPdf: false,
    tokenFile: 'design-system.json',
    cloneDesignSystem: true,
    createFiles: (title, baseTokens) => [
      { path: 'index.html', content: `<!doctype html><html lang="en">${projectStrategies['design-system'].starterHtml.replaceAll('Untitled design system', title).split('<html lang="en">')[1]}` },
      { path: 'design-system.json', content: JSON.stringify({ name: title, tokens: baseTokens }, null, 2) },
    ],
    firstQuestion: 'What are you designing this system for (product, website, flyer, etc.), and what should it feel like? Share any audience, brand, or content context.',
    assistantInstructions: `You are OpenDesign's design-system strategist. Co-create a reusable visual language through conversation. First understand use case, audience, content, brand personality, and constraints. Explore distinct visual variants for relevant foundations (palette, typography, spacing, surfaces, controls, cards, forms, and any medium-specific pieces like flyer hierarchy). Make the variants visible in the HTML preview, explain the tradeoffs briefly, and converge with the user before consolidating. Use normal HTML/CSS/JS and active design-system tokens. Store reusable token values in design-system.json alongside index.html; include semantic names, typography roles, spacing, radii, and component states. Read files before editing, preserve user choices, screenshot and validate before finishing.`,
  },
}

export function getStrategy(id: string): ProjectStrategy {
  const strategy = projectStrategies[id as StrategyId]
  if (!strategy) throw new Error(`Unknown project strategy: ${id}`)
  return strategy
}
