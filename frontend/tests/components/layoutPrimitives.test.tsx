/**
 * Frontend smoothness pass — shared primitives hold their layout with long
 * text, so pages don't wrap labels onto two lines or push the page sideways.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AppPageHeader, AppTable, KPIStatCard } from '@/components/ui-system'

const LONG = 'Northside Integrated Physiotherapy and Sports Rehabilitation Centre'

describe('Badge', () => {
  it('stays on one line and is never squeezed', () => {
    render(<Badge>Awaiting Payment</Badge>)
    const badge = screen.getByText('Awaiting Payment')
    expect(badge.className).toContain('whitespace-nowrap')
    expect(badge.className).toContain('shrink-0')
  })
})

describe('AppPageHeader', () => {
  it('lets a long title shrink and wrap, and lets the actions wrap', () => {
    render(<AppPageHeader title={LONG} actions={<button type="button">Invite Member</button>} />)
    const title = screen.getByRole('heading', { level: 1, name: LONG })
    expect(title.className).toContain('break-words')
    expect(title.parentElement!.className).toMatch(/\bmin-w-0\b/)
    const actions = screen.getByRole('button', { name: 'Invite Member' }).parentElement!
    expect(actions.className).toContain('flex-wrap')
    expect(actions.className).toContain('shrink-0')
  })

  it('only switches to a side-by-side row from lg (the sidebar takes 264px from md)', () => {
    const { container } = render(<AppPageHeader title="Team" />)
    const root = container.firstElementChild!
    expect(root.className).toContain('lg:flex-row')
    expect(root.className).not.toMatch(/(^|\s)sm:flex-row/)
  })
})

describe('KPIStatCard', () => {
  it('truncates a long label (full text in the tooltip) and keeps the icon square', () => {
    const { container } = render(
      <KPIStatCard label="Admin time saved per provider per week" value="1,240" icon={Users} />
    )
    const label = screen.getByText('Admin time saved per provider per week')
    expect(label.className).toContain('truncate')
    expect(label.className).toContain('min-w-0')
    expect(label).toHaveAttribute('title', 'Admin time saved per provider per week')
    const icon = container.querySelector('svg')!.parentElement!
    expect(icon.className).toContain('shrink-0')
    expect(screen.getByText('1,240').className).toContain('tabular-nums')
  })
})

describe('AppTable', () => {
  type Row = { id: string; name: string; note: string }
  const rows: Row[] = [{ id: 'r1', name: LONG, note: 'A long free-text note that may wrap' }]

  it('keeps headers and cells on one line and scrolls instead of squeezing', () => {
    render(
      <AppTable<Row>
        columns={[
          { key: 'name', header: 'Clinic name', render: (r) => r.name },
          { key: 'note', header: 'Notes', render: (r) => r.note, wrap: true },
        ]}
        data={rows}
        keyExtractor={(r) => r.id}
      />
    )
    const table = screen.getByRole('table')
    expect(table.className).toContain('min-w-max')
    expect(table.closest('.overflow-x-auto')).not.toBeNull()

    for (const th of within(table).getAllByRole('columnheader')) {
      expect(th.className).toContain('whitespace-nowrap')
    }
    const [nameCell, noteCell] = within(table).getAllByRole('cell')
    expect(nameCell!.className).toContain('whitespace-nowrap')
    // `wrap` opts a free-text column back into wrapping.
    expect(noteCell!.className).toContain('whitespace-normal')
    expect(noteCell!.className).not.toContain('whitespace-nowrap')
  })
})

describe('global layout rules (app/globals.css)', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'globals.css'), 'utf8')

  it('lets grid items shrink, so a wide table scrolls in its card instead of the page', () => {
    // Found by the manual guide: /dashboard/front-desk at 820px with real rows.
    expect(css).toMatch(/:where\(\.grid\)\s*>\s*\*\s*\{\s*min-width:\s*0;?\s*\}/)
  })

  it('wraps long unbroken values instead of overflowing', () => {
    expect(css).toMatch(/overflow-wrap:\s*break-word/)
  })
})
