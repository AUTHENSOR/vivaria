import assert from 'node:assert'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { mock } from 'node:test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { background, getUsageInSeconds, moveDirToBuildContextCache, oneTimeBackgroundProcesses } from './util'

describe('background', () => {
  test('handles functions that throw errors', async () => {
    const consoleWarn = mock.method(console, 'warn', () => {})

    let resolveUnhandledRejectionPromise: (value: unknown) => void
    const unhandledRejectionPromise = new Promise(resolve => {
      resolveUnhandledRejectionPromise = resolve
    })
    process.on('unhandledRejection', () => {
      resolveUnhandledRejectionPromise(undefined)
    })

    background(
      'test',
      (async () => {
        throw new Error('test')
      })(),
    )

    await oneTimeBackgroundProcesses.awaitTerminate()

    // Check that the unhandledRejection handler isn't called in the next 100 milliseconds
    const result = await Promise.race([
      unhandledRejectionPromise,
      new Promise(resolve => setTimeout(() => resolve(true), 100)),
    ])
    assert.ok(result)

    assert.strictEqual(consoleWarn.mock.callCount(), 1)
    assert.deepStrictEqual(consoleWarn.mock.calls[0].arguments, [new Error('bg test: test')])
  })
})

describe('getUsageInSeconds', () => {
  test('computes usage excluding paused time', () => {
    assert.equal(getUsageInSeconds({ startTimestamp: 0, endTimestamp: 10_000, pausedMs: 2_500 }), 8)
  })

  test('floors usage at zero when paused time exceeds elapsed time', () => {
    // A client-stamped pause predating the branch can otherwise make usage hugely negative
    // (e.g. start: 0 subtracting the entire epoch from the branch's elapsed time).
    assert.equal(
      getUsageInSeconds({
        startTimestamp: 1_700_000_000_000,
        endTimestamp: 1_700_003_600_000,
        pausedMs: 1_700_003_600_000,
      }),
      0,
    )
    assert.equal(getUsageInSeconds({ startTimestamp: 0, endTimestamp: 10_000, pausedMs: 1_792_404_697_980 }), 0)
    assert.equal(getUsageInSeconds({ startTimestamp: 0, endTimestamp: 10_000, pausedMs: 10_500 }), 0)
  })
})

describe('moveDirToBuildContextCache', () => {
  let tempDir: string
  let cacheDir: string
  let dest: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'temp-'))
    await fs.writeFile(path.join(tempDir, 'file'), 'contents')

    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-'))
    dest = path.join(cacheDir, 'dest')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.rm(cacheDir, { recursive: true, force: true })
  })

  test('moves a directory between the given locations', async () => {
    await moveDirToBuildContextCache(tempDir, dest)

    // Assert dest exists
    await fs.access(dest)
    // Assert tempDir no longer exists
    await expect(fs.access(tempDir)).rejects.toThrow()

    expect(await fs.readFile(path.join(dest, 'file'), 'utf8')).toEqual('contents')
  })

  test('does nothing if the destination already exists', async () => {
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(path.join(dest, 'file'), 'different contents')

    await moveDirToBuildContextCache(tempDir, dest)

    // Assert dest exists
    await fs.access(dest)
    // Assert tempDir no longer exists
    await expect(fs.access(tempDir)).rejects.toThrow()

    expect(await fs.readFile(path.join(dest, 'file'), 'utf8')).toEqual('different contents')
  })
})
