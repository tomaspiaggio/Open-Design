/** Shared theme helpers. This module is imported by both the browser UI and the
    Node server, so it must stay free of Node-only dependencies (fs, path, etc.). */

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

export function liveThemeCss(tokens: DesignTokens) {
  const { color, font, radius } = tokens.tokens
  const ink = safeCssValue(color.ink)
  const canvas = safeCssValue(color.canvas)
  const brand = safeCssValue(color.brand)
  const accent = safeCssValue(color.accent)
  const muted = safeCssValue(color.muted)
  const bodyFont = safeCssValue(font.body)
  const displayFont = safeCssValue(font.display)
  const cardRadius = safeCssValue(radius.card)
  return `:root {
  --background:${canvas}; --foreground:${ink}; --card:${canvas}; --card-foreground:${ink}; --popover:${canvas}; --popover-foreground:${ink};
  --primary:${brand}; --primary-foreground:${canvas}; --secondary:${muted}; --secondary-foreground:${ink}; --muted:${muted}; --muted-foreground:${ink};
  --accent:${accent}; --accent-foreground:${ink}; --destructive:#dc2626; --destructive-foreground:${canvas}; --border:${muted}; --input:${muted}; --ring:${brand};
  --chart-1:${brand}; --chart-2:${accent}; --chart-3:${muted}; --chart-4:${ink}; --chart-5:${canvas};
  --sidebar:${canvas}; --sidebar-foreground:${ink}; --sidebar-primary:${brand}; --sidebar-primary-foreground:${canvas}; --sidebar-accent:${accent}; --sidebar-accent-foreground:${ink}; --sidebar-border:${muted}; --sidebar-ring:${brand};
  --radius:${cardRadius}; --font-sans:${bodyFont}; --font-serif:${displayFont};
  /* Compatibility aliases for existing agent-authored project stylesheets. */
  --canvas:${canvas}; --ink:${ink}; --brand:${brand}; --accent:${accent}; --muted:${muted}; --surface:${canvas};
  --hairline:color-mix(in srgb, ${ink} 14%, ${canvas}); --on-brand:${canvas}; --disabled-bg:color-mix(in srgb, ${canvas} 88%, ${ink}); --disabled-text:${muted};
  --font-body:${bodyFont}; --font-display:${displayFont}; --r-card:${cardRadius}; --r-btn:${cardRadius};
  --od-ink:${ink}; --od-canvas:${canvas}; --od-brand:${brand}; --od-accent:${accent}; --od-muted:${muted}; --od-surface:${canvas}; --od-font-display:${displayFont}; --od-font-body:${bodyFont}; --od-radius-card:${cardRadius}; --od-radius-button:${cardRadius};
}`
}

/** Accepts both the canonical DesignTokens shape and the flatter token JSON
    commonly produced by agents, while retaining fields not edited in the UI. */
export function normalizeDesignSystemDocument(document: unknown, fallback: DesignTokens): DesignTokens | null {
  if (!isRecord(document) || !isRecord(document.tokens)) return null
  const outerTokens = document.tokens
  const source = isRecord(outerTokens.tokens) ? outerTokens.tokens : outerTokens
  const colors = isRecord(source.color) ? source.color : {}
  const fonts = isRecord(source.font) ? source.font : {}
  const radii = isRecord(source.radius) ? source.radius : {}
  const pick = (value: unknown, previous: string) => typeof value === 'string' && value.trim() ? value : previous
  const color = {
    ink: pick(colors.ink, fallback.tokens.color.ink),
    canvas: pick(colors.canvas, fallback.tokens.color.canvas),
    brand: pick(colors.brand, fallback.tokens.color.brand),
    accent: pick(colors.accent, fallback.tokens.color.accent),
    muted: pick(colors.muted, fallback.tokens.color.muted),
  }
  const font = {
    body: pick(fonts.body, fallback.tokens.font.body),
    display: pick(fonts.display, fallback.tokens.font.display),
  }
  const radius = { card: pick(radii.card, fallback.tokens.radius.card) }
  const hasFoundationValues = [...Object.values(colors), ...Object.values(fonts), ...Object.values(radii)].some(value => typeof value === 'string')
  if (!hasFoundationValues) return null
  return {
    ...fallback,
    name: typeof document.name === 'string' ? document.name : typeof outerTokens.name === 'string' ? outerTokens.name : fallback.name,
    shadcnCss: typeof outerTokens.shadcnCss === 'string' ? outerTokens.shadcnCss : fallback.shadcnCss,
    tokens: { color, font, radius },
  }
}

export function synchronizeFoundationTokens(tokens: DesignTokens): DesignTokens {
  const shadcnBase = tokens.shadcnCss ?? `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --font-sans: var(--od-font-body);
  --font-serif: var(--od-font-display);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}
`
  const withoutPreviousOverrides = shadcnBase.replace(/\/\* opendesign:foundations:start \*\/[\s\S]*?\/\* opendesign:foundations:end \*\//g, '').trimEnd()
  return { ...tokens, shadcnCss: `${withoutPreviousOverrides}\n\n/* opendesign:foundations:start */\n${liveThemeCss(tokens)}\n/* opendesign:foundations:end */` }
}

function safeCssValue(value: string) {
  return value.replace(/[;{}<>\\\u0000-\u001f]/g, '').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
