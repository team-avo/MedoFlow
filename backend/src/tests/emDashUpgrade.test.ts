import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'
import {
  SITE_PAGE_COPY_FIELDS,
  removeEmDashes,
  upgradeEmDashes,
  upgradeRow,
} from '../site/services/emDashUpgrade'

const D = '\u2014'
// Built up so this file passes the em dash guard it tests.
const MDASH = '&' + 'mdash;'
const NUM = '&' + '#8212;'

describe('removeEmDashes (CTO-11)', () => {
  it.each([
    [`Fast assessments ${D} clear plans`, 'Fast assessments, clear plans'],
    [`Open 9${D}5`, 'Open 9-5'],
    [`Book now ${MDASH} same week`, 'Book now, same week'],
    [`Book now ${NUM} same week`, 'Book now, same week'],
    [`${D} Sarah M.`, 'Sarah M.'],
    ['No dashes here', 'No dashes here'],
    ['Ranges use en dashes \u2013 untouched', 'Ranges use en dashes \u2013 untouched'],
  ])('%s', (input, expected) => {
    expect(removeEmDashes(input)).toBe(expected)
  })
})

describe('upgradeEmDashes', () => {
  const sections = [
    { type: 'hero', props: { heading: `Care ${D} close to home`, ctas: [{ label: 'Book' }] } },
    { type: 'faq', props: { items: [{ q: 'Walk-ins?', a: `Yes ${D} weekdays` }], n: 3 } },
  ]

  it('rewrites every nested string and counts them', () => {
    const { value, changed } = upgradeEmDashes(sections)
    expect(changed).toBe(2)
    expect(value[0]!.props.heading).toBe('Care, close to home')
    expect(value[1]!.props.items![0]!.a).toBe('Yes, weekdays')
    // Everything else is untouched, including non-string values and keys.
    expect(value[1]!.props.n).toBe(3)
    expect(value[0]!.props.ctas).toEqual([{ label: 'Book' }])
    expect(sections[0]!.props.heading).toContain(D) // the input is not mutated
  })

  it('is idempotent', () => {
    const once = upgradeEmDashes(sections).value
    const twice = upgradeEmDashes(once)
    expect(twice.changed).toBe(0)
    expect(twice.value).toEqual(once)
  })

  it('leaves null, numbers and booleans alone', () => {
    expect(upgradeEmDashes(null)).toEqual({ value: null, changed: 0 })
    expect(upgradeEmDashes({ a: 1, b: true })).toEqual({ value: { a: 1, b: true }, changed: 0 })
  })
})

describe('upgradeRow', () => {
  it('returns only the fields that change, draft and published alike', () => {
    const row = {
      title: 'Home',
      sectionsJson: [{ props: { heading: `Live ${D} copy` } }],
      draftSectionsJson: [{ props: { heading: `Draft ${D} copy` } }],
      seoTitle: `Clinic ${D} Book online`,
      seoDescription: null,
      draftTitle: null,
      draftSeoTitle: undefined,
      draftSeoDescription: 'Plain',
    }
    const { data, changed } = upgradeRow(row, SITE_PAGE_COPY_FIELDS)
    expect(changed).toBe(3)
    expect(Object.keys(data).sort()).toEqual(['draftSectionsJson', 'sectionsJson', 'seoTitle'])
    expect(data.seoTitle).toBe('Clinic, Book online')
  })

  it('reports nothing for a clean row', () => {
    expect(upgradeRow({ title: 'Home', seoTitle: 'Clinic' }, SITE_PAGE_COPY_FIELDS)).toEqual({
      data: {},
      changed: 0,
    })
  })
})

describe('scripts/check-no-em-dash.js', () => {
  const require = createRequire(__filename)
  const guard = require('../../../scripts/check-no-em-dash.js') as {
    findEmDashes: (files: string[]) => string[]
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-dash-'))
  const write = (name: string, text: string) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, text)
    return file
  }

  it('flags the character and its HTML entities, with the line number', () => {
    const file = write('bad.tsx', `ok\nconst a = 'x ${D} y'\n<p>a ${MDASH} b</p>\n<p>${NUM}</p>\n`)
    const findings = guard.findEmDashes([file])
    expect(findings).toHaveLength(3)
    expect(findings[0]).toMatch(/bad\.tsx:2:/)
  })

  it('passes clean files and the \\u2014 escape', () => {
    const file = write('ok.ts', "const re = /[\\u2014-]/\nconst s = 'a, b'\n")
    expect(guard.findEmDashes([file])).toEqual([])
  })
})
