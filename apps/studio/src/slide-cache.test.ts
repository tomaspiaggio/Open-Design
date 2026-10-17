import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncValueCache } from './slide-cache.js'

test('concurrent thumbnail preloads share work and revisiting returns the cached image', async () => {
  const cache = new AsyncValueCache<string>()
  let loads = 0
  const load = async () => { loads += 1; return 'data:image/png;base64,thumb-1' }

  const [first, concurrent] = await Promise.all([
    cache.getOrLoad('project:slide-1', load),
    cache.getOrLoad('project:slide-1', load),
  ])

  assert.equal(first, 'data:image/png;base64,thumb-1')
  assert.equal(concurrent, first)
  assert.equal(await cache.getOrLoad('project:slide-1', load), first)
  assert.equal(loads, 1)
})

test('invalidation refreshes changed thumbnails and ignores an older in-flight result', async () => {
  const cache = new AsyncValueCache<string>()
  let finishOldLoad!: (value: string) => void
  const stale = cache.getOrLoad('project:slide-2', () => new Promise<string>(resolve => { finishOldLoad = resolve }))

  cache.invalidate()
  const fresh = await cache.getOrLoad('project:slide-2', async () => 'data:image/png;base64,updated')
  finishOldLoad('data:image/png;base64,stale')
  await stale

  assert.equal(fresh, 'data:image/png;base64,updated')
  assert.equal(cache.get('project:slide-2'), 'data:image/png;base64,updated')
})
