/**
 * Frontend smoothness pass — source-level guards that keep the app light:
 *  - no animation / 3D / smooth-scroll library comes back (framer-motion,
 *    three, @react-three, lenis);
 *  - no full-screen blocking loader comes back (GlobalApiLoader);
 *  - no compositor-heavy or attention-grabbing utilities: backdrop-blur,
 *    transition-all, animate-ping, animate-bounce;
 *  - the removed packages stay out of package.json.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'contexts']

function sourceFiles(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|jsx|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        out.push({ file: path.relative(ROOT, full), text: fs.readFileSync(full, 'utf8') })
      }
    }
  }
  for (const d of SOURCE_DIRS) walk(path.join(ROOT, d))
  return out
}

const files = sourceFiles()

function findAll(re: RegExp) {
  const hits: string[] = []
  for (const { file, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
  return hits
}

describe('no heavy motion libraries', () => {
  it('nothing imports framer-motion, three, @react-three/* or lenis', () => {
    expect(
      findAll(/from\s+['"](framer-motion|three|@react-three\/[\w-]+|lenis)(\/[\w/-]*)?['"]/)
    ).toEqual([])
    expect(findAll(/import\(\s*['"](framer-motion|three|@react-three\/[\w-]+|lenis)['"]/)).toEqual(
      []
    )
  })

  it('the removed packages are not dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const name of [
      'framer-motion',
      'three',
      '@types/three',
      '@react-three/fiber',
      '@react-three/drei',
      'lenis',
    ]) {
      expect(deps[name], name).toBeUndefined()
    }
  })
})

describe('no blocking loader', () => {
  it('the full-screen GlobalApiLoader overlay is not imported or rendered', () => {
    expect(findAll(/from\s+['"][^'"]*GlobalApiLoader['"]|<GlobalApiLoader\b/)).toEqual([])
  })

  it('the root layout mounts the non-blocking TopProgressBar', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/<TopProgressBar\s*\/>/)
  })
})

describe('no compositor-heavy utilities', () => {
  it('no backdrop-blur (a full re-blur of everything behind on each frame)', () => {
    expect(findAll(/(^|[\s"'`:])backdrop-blur/)).toEqual([])
  })

  it('no transition-all (animates layout properties; use transition-colors)', () => {
    expect(findAll(/(^|[\s"'`:])transition-all\b/)).toEqual([])
  })

  it('no animate-ping / animate-bounce attention loops', () => {
    expect(findAll(/(^|[\s"'`:])animate-(ping|bounce)\b/)).toEqual([])
  })
})
