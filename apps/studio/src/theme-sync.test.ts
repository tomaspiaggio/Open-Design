import assert from 'node:assert/strict'
import test from 'node:test'
import { liveThemeCss, normalizeDesignSystemDocument, synchronizeFoundationTokens, type DesignTokens } from './theme.js'

const tokens: DesignTokens = {
  name: 'Northstar',
  shadcnCss: ':root { --background: white; --foreground: black; --primary: blue; --accent: gray; --muted-foreground: gray; --font-sans: sans-serif; }',
  tokens: {
    color: { ink: '#171717', canvas: '#f5f1e8', brand: '#2457d6', accent: '#dc643c', muted: '#706b63' },
    font: { display: "'Source Serif 4', Georgia, serif", body: 'Inter, sans-serif' },
    radius: { card: '12px' },
  },
}

test('foundation edits update the stored shadcn variables without duplicating overrides', () => {
  const updated = synchronizeFoundationTokens(tokens)
  assert.match(updated.shadcnCss ?? '', /--background:\s*#f5f1e8/)
  assert.match(updated.shadcnCss ?? '', /--foreground:\s*#171717/)
  assert.match(updated.shadcnCss ?? '', /--primary:\s*#2457d6/)
  assert.match(updated.shadcnCss ?? '', /--font-sans:\s*Inter, sans-serif/)
  const updatedAgain = synchronizeFoundationTokens(updated)
  assert.equal(updatedAgain.shadcnCss?.match(/opendesign:foundations:start/g)?.length, 1)
})

test('live preview theme includes shadcn and OpenDesign foundation variables', () => {
  const css = liveThemeCss(tokens)
  assert.match(css, /--background:\s*#f5f1e8/)
  assert.match(css, /--primary:\s*#2457d6/)
  assert.match(css, /--od-brand:\s*#2457d6/)
  assert.match(css, /--font-sans:\s*Inter, sans-serif/)
})

test('a new system gets a portable shadcn globals stylesheet with complete semantic mappings', () => {
  const { shadcnCss } = synchronizeFoundationTokens({ ...tokens, shadcnCss: undefined })
  assert.ok(shadcnCss)
  assert.match(shadcnCss, /@import "tailwindcss"/)
  assert.match(shadcnCss, /--background:\s*#f5f1e8/)
  assert.match(shadcnCss, /--color-sidebar-primary:\s*var\(--sidebar-primary\)/)
  assert.match(shadcnCss, /--font-sans:\s*var\(--od-font-body\)/)
  assert.match(shadcnCss, /--radius-lg:\s*var\(--radius\)/)
  assert.match(shadcnCss, /--radius:\s*12px/)
  assert.doesNotMatch(shadcnCss, /--font-sans:\s*var\(--font-sans\)/)
})

test('live theme bridges the short token aliases used by saved design-system HTML', () => {
  const css = liveThemeCss(tokens)
  assert.match(css, /--canvas:\s*#f5f1e8/)
  assert.match(css, /--ink:\s*#171717/)
  assert.match(css, /--brand:\s*#2457d6/)
  assert.match(css, /--font-body:\s*Inter, sans-serif/)
  assert.match(css, /--r-card:\s*12px/)
})

test('design-system documents written in the agent flat token shape normalize to the inspector schema', () => {
  const normalized = normalizeDesignSystemDocument({
    name: 'Litho',
    tokens: {
      color: { ink: '#101010', canvas: '#f8f7f4', brand: '#a04c29', accent: '#686746', muted: '#77736b', surface: '#fcfbf9' },
      font: { body: 'Inter, sans-serif', display: 'Georgia, serif' },
      radius: { card: '14px', button: '10px' },
      gradient: { brand: 'linear-gradient(red, blue)' },
    },
  }, tokens)
  assert.equal(normalized?.name, 'Litho')
  assert.equal(normalized?.tokens.color.canvas, '#f8f7f4')
  assert.equal(normalized?.tokens.font.display, 'Georgia, serif')
  assert.equal(normalized?.tokens.radius.card, '14px')
  assert.equal(normalized?.shadcnCss, tokens.shadcnCss)
})
