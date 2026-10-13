/**
 * Source-level guards that fail CI when a PHI-hygiene rule is broken:
 *  - F0.3.1 no PHI in URLs: no route, link or API URL puts a patient
 *    identifier (email, name, phone, DOB, …) into a path or query string;
 *  - F0.3.3 client telemetry: no analytics / monitoring SDK or script is
 *    added unless it is registered in telemetry-allowlist.json with its BAA
 *    reference and a beforeSend that uses scrubPhi;
 *  - F0.2.3 no token in Web Storage.
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
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        out.push({ file: path.relative(ROOT, full), text: fs.readFileSync(full, 'utf8') })
      }
    }
  }
  for (const d of SOURCE_DIRS) walk(path.join(ROOT, d))
  return out
}

const files = sourceFiles()
const PHI_PARAM =
  '(email|e-?mail|name|firstName|lastName|fullName|patientName|phone|mobile|dob|dateOfBirth|birthDate|address|diagnosis|notes?|ssn|insurance)'

function findAll(re: RegExp) {
  const hits: string[] = []
  for (const { file, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
  return hits
}

describe('F0.3.1 no PHI in URLs', () => {
  it('no query string carries a PHI-named parameter', () => {
    expect(findAll(new RegExp(`[?&]${PHI_PARAM}=`, 'i'))).toEqual([])
  })

  it('no URLSearchParams / axios params object sets a PHI-named key', () => {
    expect(findAll(new RegExp(`\\.(set|append)\\(\\s*['"\`]${PHI_PARAM}['"\`]`, 'i'))).toEqual([])
    expect(findAll(new RegExp(`params:\\s*\\{[^}]*\\b${PHI_PARAM}\\s*[:,}]`, 'i'))).toEqual([])
  })

  it('dynamic route segments are ids or tokens, never PHI', () => {
    const appDir = path.join(ROOT, 'app')
    const segments: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const m = e.name.match(/^\[+\.{0,3}([^\]]+)\]+$/)
        if (m) segments.push(m[1]!)
        walk(path.join(dir, e.name))
      }
    }
    walk(appDir)
    expect(segments.length).toBeGreaterThan(0)
    for (const s of segments) expect(s).toMatch(/^(id|[a-zA-Z]+Id|token|slug)$/)
  })
})

describe('F0.3.3 client telemetry is PHI-scrubbed or BAA-covered', () => {
  const TELEMETRY_PACKAGES =
    /^(@sentry\/|@datadog\/browser|posthog|mixpanel|@segment\/|analytics-next|@amplitude\/|amplitude-js|logrocket|@fullstory\/|hotjar|@vercel\/analytics|@vercel\/speed-insights|react-ga|@next\/third-parties|newrelic|@newrelic\/|@bugsnag\/|rollbar|@microsoft\/applicationinsights|@honeybadger-io\/|heap-api|@heap\/)/
  const TELEMETRY_HOSTS =
    /(googletagmanager\.com|google-analytics\.com|cdn\.segment\.com|static\.hotjar\.com|cdn\.mxpnl\.com|browser\.sentry-cdn\.com|js-agent\.newrelic\.com|clarity\.ms|fullstory\.com|cdn\.amplitude\.com|cdn\.logrocket)/

  const allow: { package: string; baa: string; scrubber: string }[] = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'telemetry-allowlist.json'), 'utf8')
  ).allowed

  it('every telemetry SDK in package.json is allow-listed with a BAA and a scrubber', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    const telemetry = deps.filter((d) => TELEMETRY_PACKAGES.test(d))
    for (const dep of telemetry) {
      const entry = allow.find((a) => a.package === dep)
      expect(entry, `${dep} is a telemetry SDK: add it to telemetry-allowlist.json`).toBeTruthy()
      expect(entry!.baa, `${dep} needs a BAA reference (or "no-phi" + scrubber)`).toBeTruthy()
      expect(entry!.scrubber).toBe('lib/phiScrub.ts#scrubPhi')
    }
  })

  it('no third-party analytics / monitoring script is loaded from source', () => {
    expect(findAll(TELEMETRY_HOSTS)).toEqual([])
  })
})

describe('F0.2.3 tokens never go to Web Storage', () => {
  it('no localStorage/sessionStorage write of a token-like key', () => {
    expect(
      findAll(/(localStorage|sessionStorage)\.setItem\(\s*[^,]*(token|jwt|auth|session|secret)/i)
    ).toEqual([])
  })
})
