import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppStore } from '../../core/store'
import { MemoryAdapter } from '../../storage/memoryAdapter'
import { StoreContext } from '../useStore'
import { Sidebar } from '../Sidebar'

const NOW = new Date(2026, 6, 28, 9, 0, 0)

async function mount() {
  const store = await AppStore.create({
    adapter: new MemoryAdapter(), now: () => NOW, scheduler: (_m, f) => f(),
  })
  const view = render(
    <StoreContext.Provider value={store}>
      <Sidebar onNavigate={() => {}} />
    </StoreContext.Provider>,
  )
  return { store, view }
}

beforeEach(() => cleanup())

describe('List editor', () => {
  it('builtInListsHaveNoEditAffordance', async () => {
    await mount()
    for (const name of ['Inbox', 'Next actions', 'Waiting for...', 'Someday', 'Notes']) {
      expect(screen.queryByRole('button', { name: `Edit ${name}` }), name).toBeNull()
    }
  })

  it('userListsDoHaveOne', async () => {
    const { store } = await mount()
    store.addList('Work', null)
    expect(await screen.findByRole('button', { name: 'Edit Work' })).toBeTruthy()
  })

  it('offersExactlyTwelveColoursAndSixteenIcons', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    store.addList('Work', null)
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))

    const colours = screen.getByRole('radiogroup', { name: 'List colour' })
    const icons = screen.getByRole('radiogroup', { name: 'List icon' })
    expect(within(colours).getAllByRole('radio')).toHaveLength(12)
    expect(within(icons).getAllByRole('radio')).toHaveLength(16)
  })

  it('choosingAColourStoresTheSwiftHex', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    const list = store.addList('Work', null)!
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await user.click(screen.getByRole('radio', { name: 'Blue' }))
    // The stored value is the hex macOS knows, not a label or a CSS colour.
    expect(store.list(list.id)!.colorHex).toBe('#007AFF')
  })

  it('choosingAnIconStoresTheSFSymbolName', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    const list = store.addList('Work', null)!
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await user.click(screen.getByRole('radio', { name: 'Briefcase' }))
    expect(store.list(list.id)!.symbol).toBe('briefcase')
  })

  it('clickingTheSelectedChoiceClearsIt', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    const list = store.addList('Work', null)!
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await user.click(screen.getByRole('radio', { name: 'Blue' }))
    await user.click(screen.getByRole('radio', { name: 'Blue' }))
    expect(store.list(list.id)!.colorHex).toBeNull()
  })

  it('selectionIsNotIndicatedByColourAlone', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    store.addList('Work', null)
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    const blue = screen.getByRole('radio', { name: 'Blue' })
    await user.click(blue)
    // aria-checked for assistive tech, and a visible tick for everyone else.
    expect(blue.getAttribute('aria-checked')).toBe('true')
    expect(blue.textContent).toContain('✓')
  })

  it('renamingTrimsAndRejectsBlank', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    const list = store.addList('Work', null)!
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))

    const field = screen.getByLabelText('Name')
    await user.clear(field)
    await user.type(field, '  Deep work  ')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(store.list(list.id)!.name).toBe('Deep work')
  })

  it('aBlankRenameLeavesTheNameAlone', async () => {
    const user = userEvent.setup()
    const { store } = await mount()
    const list = store.addList('Work', null)!
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(store.list(list.id)!.name).toBe('Work')
  })

  it('theSidebarRowRendersAnIconForEveryList', async () => {
    const { store } = await mount()
    const list = store.addList('Work', null)!
    store.setListSymbol(list.id, 'briefcase')
    store.setListColor(list.id, '#007AFF')
    const row = await screen.findByRole('button', { name: 'Work' })
    const icon = row.querySelector('svg')
    expect(icon).not.toBeNull()
    // The tint is applied to the wrapper, not baked into the glyph.
    expect((row.querySelector('.nav__icon') as HTMLElement).style.color).toBeTruthy()
  })

  it('anUncustomisedListStillShowsTheDefaultGlyph', async () => {
    const { store } = await mount()
    store.addList('Plain', null)
    const row = await screen.findByRole('button', { name: 'Plain' })
    expect(row.querySelector('svg')).not.toBeNull()
  })
})
