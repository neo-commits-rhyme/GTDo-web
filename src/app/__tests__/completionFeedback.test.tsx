import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { StoreContext } from '../useStore'
import { TaskList } from '../TaskList'
import { UndoContext } from '../undo/useUndo'
import { UndoCenter } from '../../core/undo'
import { completionSoundEnabled, setCompletionSoundEnabled, playCompletionSound, SOUND_KEY } from '../sound'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

/** Counts oscillators so "played a tone" is observable without real audio. */
function stubAudio() {
  const started: number[] = []
  class FakeParam { setValueAtTime() {} exponentialRampToValueAtTime() {} }
  class FakeCtx {
    currentTime = 0
    state = 'running'
    destination = {}
    createGain() { return { gain: new FakeParam(), connect: () => {} } }
    createOscillator() {
      return {
        type: '', frequency: new FakeParam(), connect: () => {},
        start: () => { started.push(1) }, stop: () => {},
      }
    }
    resume() { return Promise.resolve() }
  }
  vi.stubGlobal('AudioContext', FakeCtx as unknown as typeof AudioContext)
  return started
}

async function mount() {
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  store.addTask('buy milk', { kind: 'smart', view: 'today' })
  render(
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={new UndoCenter(() => {})}>
        <TaskList />
      </UndoContext.Provider>
    </StoreContext.Provider>,
  )
  return store
}

beforeEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

describe('Completion sound', () => {
  it('defaultsOnMatchingMacOS', () => {
    expect(completionSoundEnabled()).toBe(true)
  })

  it('theToggleIsPersisted', () => {
    setCompletionSoundEnabled(false)
    expect(localStorage.getItem(SOUND_KEY)).toBe('false')
    expect(completionSoundEnabled()).toBe(false)
    setCompletionSoundEnabled(true)
    expect(completionSoundEnabled()).toBe(true)
  })

  it('completingPlaysATone', async () => {
    const started = stubAudio()
    const user = userEvent.setup()
    await mount()
    await user.click(await screen.findByRole('checkbox', { name: 'Complete buy milk' }))
    expect(started.length).toBeGreaterThan(0)
  })

  it('unCompletingPlaysNothing', async () => {
    const started = stubAudio()
    const user = userEvent.setup()
    const store = await mount()
    const task = store.data.tasks[0]!
    store.toggleCompleted(task.id)
    started.length = 0
    await user.click(await screen.findByRole('checkbox', { name: 'Un-complete buy milk' }))
    expect(started.length).toBe(0)
  })

  it('respectsTheSetting', async () => {
    const started = stubAudio()
    setCompletionSoundEnabled(false)
    const user = userEvent.setup()
    await mount()
    await user.click(await screen.findByRole('checkbox', { name: 'Complete buy milk' }))
    expect(started.length).toBe(0)
  })

  it('aRefusedAudioContextNeverBreaksCompletion', async () => {
    // Some browsers throw outright; the task must still complete.
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('refused') } })
    const user = userEvent.setup()
    const store = await mount()
    await user.click(await screen.findByRole('checkbox', { name: 'Complete buy milk' }))
    expect(store.data.tasks[0]!.isCompleted).toBe(true)
  })

  it('noAudioSupportAtAllIsSurvivable', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => playCompletionSound()).not.toThrow()
  })
})

describe('Completion motion', () => {
  it('theCompletedCircleUsesTheDoneTokenNotAHardCodedColour', () => {
    const css = readFileSync('src/app/styles.css', 'utf8')
    expect(css).toMatch(/\.row--done \.row__circle \{[^}]*var\(--done\)/)
  })

  it('thePressDipComesFromTheTokenSoReducedMotionDisarmsIt', () => {
    const css = readFileSync('src/app/styles.css', 'utf8')
    expect(css).toMatch(/\.row__circle:active \{[^}]*scale\(var\(--press-scale\)\)/)
    const tokens = readFileSync('src/app/theme/tokens.css', 'utf8')
    // Because the scale lives in a token, no component needs its own
    // reduced-motion branch.
    expect(tokens).toMatch(/prefers-reduced-motion[^}]*\{[\s\S]*?--press-scale: 1;/)
  })
})
