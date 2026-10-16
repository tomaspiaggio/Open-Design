import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensureDeckEntry } from './workspace.js'
import { inspectPreviewHtml } from './preview-validation.js'
import { projectStrategies } from './strategies.js'

test('a brand-new presentation workspace has a renderable index.html for agent recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opendesign-workspace-'))
  try {
    const entry = await ensureDeckEntry(root)
    assert.match(await readFile(entry, 'utf8'), /Untitled deck/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('design-system validation rejects a document whose only section is hidden', async () => {
  const hiddenDocument = '<!doctype html><html><head><style>main>section:first-child{display:none}</style></head><body><main><section><h1>Button variants</h1></section></main></body></html>'
  const result = await inspectPreviewHtml(hiddenDocument)
  assert.equal(result.empty, true)
  assert.equal(result.metrics.visibleTextLength, 0)
  assert.equal(result.metrics.mainHeight, 0)
})

test('the design-system starter renders visible content at creation time', async () => {
  const starter = projectStrategies['design-system'].createFiles('QA system')[0]!.content
  const result = await inspectPreviewHtml(starter)
  assert.equal(result.empty, false)
  assert.ok(result.metrics.visibleTextLength > 0)
})
