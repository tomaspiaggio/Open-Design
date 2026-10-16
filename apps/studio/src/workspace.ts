import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const starterDeck = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Untitled deck</title></head>
  <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:var(--od-canvas);color:var(--od-ink);font-family:var(--od-font-display)">
    <main style="width:80%;max-width:1100px"><p style="color:var(--od-brand);font-weight:700;letter-spacing:.12em">OPENDESIGN</p><h1 style="font-size:clamp(3rem,8vw,7rem);margin:0">Untitled deck</h1><p style="font-size:1.5rem;color:var(--od-muted)">Ask the agent to create your presentation.</p></main>
  </body>
</html>`

export const starterPrototype = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Untitled prototype</title>
<style>body{margin:0;min-height:100vh;background:var(--od-canvas,#f8fafc);color:var(--od-ink,#111827);font:16px/1.5 var(--od-font-body,system-ui,sans-serif)}main{max-width:900px;margin:12vh auto;padding:32px}h1{font:700 clamp(40px,7vw,76px)/1 var(--od-font-display,system-ui,sans-serif);letter-spacing:-.06em}button{border:0;border-radius:10px;background:var(--od-brand,#4f46e5);color:white;padding:12px 18px;font:inherit;cursor:pointer}</style></head>
<body><main><p>OPENDESIGN · INTERACTIVE PROTOTYPE</p><h1>Untitled prototype</h1><p>Describe the interface you want to explore.</p><button onclick="this.textContent='It works — edit the HTML to change me'">Try the interaction</button></main></body></html>`

/** Gives the agent an editable entry point even on a brand-new workspace. */
export async function ensureDeckEntry(deckRoot: string) {
  await mkdir(deckRoot, { recursive: true })
  const entry = join(deckRoot, 'index.html')
  try {
    await readFile(entry, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(entry, starterDeck, 'utf8')
  }
  return entry
}

export async function ensurePrototypeEntry(root: string) {
  await mkdir(root, { recursive: true })
  const entry = join(root, 'index.html')
  try { await readFile(entry, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(entry, starterPrototype, 'utf8')
  }
  return entry
}
