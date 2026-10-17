import assert from 'node:assert/strict'
import test from 'node:test'
import { liveThemeCss, synchronizeFoundationTokens, type DesignTokens } from './theme.js'

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
