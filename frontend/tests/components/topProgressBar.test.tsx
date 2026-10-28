/**
 * Frontend smoothness pass — the loading indicator never blocks the screen.
 * TopProgressBar replaces the full-screen "Medoflow Syncing" overlay: a thin
 * bar for navigations, first loads and saves; background refetches of data
 * already on screen stay silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let pathname = '/dashboard'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/site/host', () => ({ isOnClinicSiteHost: () => false }))

import { TopProgressBar } from '@/components/common/TopProgressBar'

const deferred = () => {
  let resolve!: (v: unknown) => void
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <TopProgressBar />
    </QueryClientProvider>
  )
  return { client, ...utils }
}

const bar = () => screen.queryByTestId('top-progress-bar')
// jsdom cannot navigate; cancel the click after the bar's capture listener saw it.
const stopJsdomNavigation = (e: Event) => e.preventDefault()
// React Query batches cache notifications on a 0ms timer; flush them first.
const flushQueryNotifications = () => act(() => vi.advanceTimersByTime(0))

describe('TopProgressBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pathname = '/dashboard'
    document.addEventListener('click', stopJsdomNavigation)
  })
  afterEach(() => {
    vi.useRealTimers()
    document.removeEventListener('click', stopJsdomNavigation)
  })

  it('shows for a first load only after 150ms, then hides when data arrives', async () => {
    const { client } = setup()
    const call = deferred()
    act(() => {
      void client.fetchQuery({ queryKey: ['patients'], queryFn: () => call.promise })
    })
    flushQueryNotifications()
    act(() => vi.advanceTimersByTime(100))
    expect(bar()).toBeNull()
    act(() => vi.advanceTimersByTime(100))
    expect(bar()).not.toBeNull()

    await act(async () => call.resolve([]))
    flushQueryNotifications()
    expect(bar()).toBeNull()
  })

  it('stays silent while data already on screen is refetched in the background', () => {
    const { client } = setup()
    client.setQueryData(['patients'], [{ id: 'p1' }])
    const call = deferred()
    act(() => {
      void client.fetchQuery({ queryKey: ['patients'], queryFn: () => call.promise, staleTime: 0 })
    })
    flushQueryNotifications()
    expect(client.isFetching()).toBe(1)
    act(() => vi.advanceTimersByTime(1000))
    expect(bar()).toBeNull()
  })

  it('shows while a mutation (save) is running', async () => {
    const { client } = setup()
    const call = deferred()
    act(() => {
      void client
        .getMutationCache()
        .build(client, { mutationFn: () => call.promise })
        .execute(undefined)
    })
    flushQueryNotifications()
    act(() => vi.advanceTimersByTime(200))
    expect(bar()).not.toBeNull()
    await act(async () => call.resolve({}))
    flushQueryNotifications()
    expect(bar()).toBeNull()
  })

  it('shows after an internal link click until the route changes', () => {
    const { rerender, client } = setup()
    const link = document.createElement('a')
    link.href = '/dashboard/patients'
    document.body.appendChild(link)
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    act(() => vi.advanceTimersByTime(200))
    expect(bar()).not.toBeNull()

    pathname = '/dashboard/patients'
    rerender(
      <QueryClientProvider client={client}>
        <TopProgressBar />
      </QueryClientProvider>
    )
    expect(bar()).toBeNull()
    link.remove()
  })

  it('ignores external links and new-tab clicks', () => {
    setup()
    const external = document.createElement('a')
    external.href = 'https://example.test/elsewhere'
    const newTab = document.createElement('a')
    newTab.href = '/dashboard/patients'
    newTab.target = '_blank'
    document.body.append(external, newTab)
    act(() => {
      external.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      )
      newTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
    act(() => vi.advanceTimersByTime(500))
    expect(bar()).toBeNull()
    external.remove()
    newTab.remove()
  })

  it('never covers the screen and never takes pointer input', () => {
    const { client, container } = setup()
    act(() => {
      void client.fetchQuery({ queryKey: ['x'], queryFn: () => new Promise(() => {}) })
    })
    flushQueryNotifications()
    act(() => vi.advanceTimersByTime(200))
    const el = bar()!
    expect(el.className).toContain('pointer-events-none')
    expect(el.className).toContain('h-0.5')
    expect(el.className).not.toMatch(/\binset-0\b/)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('is never shown on clinic websites (/s/*)', () => {
    pathname = '/s/everwell'
    const { client } = setup()
    act(() => {
      void client.fetchQuery({ queryKey: ['x'], queryFn: () => new Promise(() => {}) })
    })
    act(() => vi.advanceTimersByTime(500))
    expect(bar()).toBeNull()
  })
})
