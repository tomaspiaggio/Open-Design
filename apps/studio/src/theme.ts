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
  const { color, font } = tokens.tokens
  return `:root { --background: ${safeCssValue(color.canvas)}; --foreground: ${safeCssValue(color.ink)}; --card: ${safeCssValue(color.canvas)}; --popover: ${safeCssValue(color.canvas)}; --primary: ${safeCssValue(color.brand)}; --accent: ${safeCssValue(color.accent)}; --muted-foreground: ${safeCssValue(color.muted)}; --font-sans: ${safeCssValue(font.body)}; --font-serif: ${safeCssValue(font.display)}; --od-ink: ${safeCssValue(color.ink)}; --od-canvas: ${safeCssValue(color.canvas)}; --od-brand: ${safeCssValue(color.brand)}; --od-accent: ${safeCssValue(color.accent)}; --od-muted: ${safeCssValue(color.muted)}; --od-font-display: ${safeCssValue(font.display)}; --od-font-body: ${safeCssValue(font.body)}; }`
}

export function synchronizeFoundationTokens(tokens: DesignTokens): DesignTokens {
  if (!tokens.shadcnCss) return tokens
  const withoutPreviousOverrides = tokens.shadcnCss.replace(/\/\* opendesign:foundations:start \*\/[\s\S]*?\/\* opendesign:foundations:end \*\//g, '').trimEnd()
  return { ...tokens, shadcnCss: `${withoutPreviousOverrides}\n\n/* opendesign:foundations:start */\n${liveThemeCss(tokens)}\n/* opendesign:foundations:end */` }
}

function safeCssValue(value: string) {
  return value.replace(/[;{}<>\\\u0000-\u001f]/g, '').trim()
}
