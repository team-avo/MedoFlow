/**
 * B2.1 / FR-12 configuration + FR-13 PHI egress gate (B2.7).
 * Switching vendors is configuration only; production refuses any AI host
 * without a BAA, the Gemini Developer API, plain http to a remote host, and
 * the mock provider.
 */
import assert from 'node:assert/strict'
import { isScribeDemoEnabled, loadScribeAiConfig } from '../services/ai/config'
import { isPrivateHost, scribeEgressProblems } from '../services/ai/egressPolicy'
import { buildScribeAi } from '../services/ai/registry'
import { collectEnvProblems } from '../config/envValidation'

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...vars })
const prod = (vars: Record<string, string>): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  ...vars,
})
const fatal = (e: NodeJS.ProcessEnv) =>
  scribeEgressProblems(e)
    .filter((p) => p.fatal)
    .map((p) => p.message)

describe('presets resolve to a full endpoint', () => {
  it('openai: one key serves both roles', () => {
    const cfg = loadScribeAiConfig(
      env({
        AI_SCRIBE_LLM_PRESET: 'openai',
        AI_SCRIBE_LLM_API_KEY: 'sk-x',
        AI_SCRIBE_STT_PRESET: 'openai',
      })
    )
    assert.deepEqual(cfg.problems, [])
    assert.equal(cfg.llm.kind, 'openai-compatible')
    assert.equal(cfg.llm.baseUrl, 'https://api.openai.com/v1')
    assert.equal(cfg.llm.model, 'gpt-4o-mini')
    assert.equal(cfg.llm.jsonMode, 'json_schema')
    assert.equal(cfg.stt.kind, 'openai-compatible')
    assert.equal(cfg.stt.model, 'whisper-1')
    assert.equal(cfg.stt.mode, 'transcriptions')
    assert.equal(cfg.stt.apiKey, 'sk-x')
  })

  it('gemini: Gemini drafting with chat-audio transcription', () => {
    const cfg = loadScribeAiConfig(
      env({
        AI_SCRIBE_LLM_PRESET: 'gemini',
        AI_SCRIBE_LLM_API_KEY: 'g-x',
        AI_SCRIBE_STT_PRESET: 'gemini',
      })
    )
    assert.equal(cfg.llm.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai')
    assert.equal(cfg.llm.model, 'gemini-2.5-flash')
    assert.equal(cfg.stt.mode, 'chat-audio')
    assert.equal(cfg.stt.apiKey, 'g-x')
  })

  it('mix and match: OpenAI transcription + Gemini drafting, keys per role', () => {
    const cfg = loadScribeAiConfig(
      env({
        AI_SCRIBE_LLM_PRESET: 'gemini',
        AI_SCRIBE_LLM_API_KEY: 'g-x',
        AI_SCRIBE_STT_PRESET: 'openai',
        AI_SCRIBE_STT_API_KEY: 'sk-y',
      })
    )
    assert.deepEqual(cfg.problems, [])
    assert.equal(cfg.llm.preset, 'gemini')
    assert.equal(cfg.stt.preset, 'openai')
    assert.equal(cfg.stt.apiKey, 'sk-y')
  })

  it('self-hosted: Ollama drafting + a whisper server, no keys', () => {
    const cfg = loadScribeAiConfig(
      env({ AI_SCRIBE_LLM_PRESET: 'ollama', AI_SCRIBE_STT_PRESET: 'whisper-server' })
    )
    assert.deepEqual(cfg.problems, [])
    assert.equal(cfg.llm.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(cfg.llm.auth, 'none')
    assert.equal(cfg.stt.baseUrl, 'http://127.0.0.1:8000/v1')
  })

  it('overrides win over the preset', () => {
    const cfg = loadScribeAiConfig(
      env({
        AI_SCRIBE_LLM_PRESET: 'ollama',
        AI_SCRIBE_LLM_BASE_URL: 'http://ollama:11434/v1/',
        AI_SCRIBE_LLM_MODEL: 'qwen2.5:7b',
        AI_SCRIBE_LLM_JSON_MODE: 'json_schema',
        AI_SCRIBE_TIMEOUT_MS: '30000',
      })
    )
    assert.equal(cfg.llm.baseUrl, 'http://ollama:11434/v1')
    assert.equal(cfg.llm.model, 'qwen2.5:7b')
    assert.equal(cfg.llm.jsonMode, 'json_schema')
    assert.equal(cfg.timeoutMs, 30000)
  })

  it('azure and vertex-gemini need their base URL (and azure its deployment name)', () => {
    const azure = loadScribeAiConfig(
      env({ AI_SCRIBE_LLM_PRESET: 'azure', AI_SCRIBE_LLM_API_KEY: 'k' })
    )
    assert.equal(azure.llm.kind, 'disabled')
    assert.ok(azure.problems.some((p) => /AI_SCRIBE_LLM_BASE_URL is required/.test(p)))
    assert.ok(azure.problems.some((p) => /AI_SCRIBE_LLM_MODEL is required/.test(p)))
    const vertex = loadScribeAiConfig(
      env({
        AI_SCRIBE_LLM_PRESET: 'vertex-gemini',
        AI_SCRIBE_LLM_BASE_URL:
          'https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/endpoints/openapi',
      })
    )
    assert.deepEqual(vertex.problems, [])
    assert.equal(vertex.llm.auth, 'google-adc')
    assert.equal(vertex.llm.model, 'google/gemini-2.5-flash')
  })

  it('unusable configurations are disabled with a clear reason', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ AI_SCRIBE_LLM_PRESET: 'openai' }, /AI_SCRIBE_LLM_API_KEY is required/],
      [{ AI_SCRIBE_LLM_PRESET: 'nope' }, /PRESET "nope" is not known/],
      [{ AI_SCRIBE_LLM_PROVIDER: 'claude-direct' }, /not a known provider/],
      [{ AI_SCRIBE_LLM_PRESET: 'whisper-server' }, /speech-to-text preset/],
      [{ AI_SCRIBE_STT_PRESET: 'ollama' }, /has no speech-to-text model/],
      [
        {
          AI_SCRIBE_LLM_PRESET: 'custom',
          AI_SCRIBE_LLM_BASE_URL: 'not a url',
          AI_SCRIBE_LLM_MODEL: 'm',
          AI_SCRIBE_LLM_API_KEY: 'k',
        },
        /not a valid URL/,
      ],
      [
        {
          AI_SCRIBE_LLM_PRESET: 'openai',
          AI_SCRIBE_LLM_API_KEY: 'k',
          AI_SCRIBE_LLM_JSON_MODE: 'xml',
        },
        /JSON_MODE must be/,
      ],
    ]
    for (const [vars, message] of cases) {
      const cfg = loadScribeAiConfig(env(vars))
      assert.ok(
        cfg.problems.some((p) => message.test(p)),
        `${JSON.stringify(vars)} → ${cfg.problems.join(' | ')}`
      )
    }
  })

  it('nothing configured = disabled (not an error); mock is explicit', () => {
    const none = loadScribeAiConfig(env({}))
    assert.equal(none.llm.kind, 'disabled')
    assert.equal(none.stt.kind, 'disabled')
    assert.deepEqual(none.problems, [])
    const mock = loadScribeAiConfig(
      env({ AI_SCRIBE_LLM_PROVIDER: 'mock', AI_SCRIBE_STT_PROVIDER: 'mock' })
    )
    assert.equal(mock.llm.kind, 'mock')
    assert.equal(mock.stt.kind, 'mock')
  })

  it('the registry builds the adapter the config names — no code change to switch', () => {
    const a = buildScribeAi(
      loadScribeAiConfig(
        env({
          AI_SCRIBE_LLM_PRESET: 'openai',
          AI_SCRIBE_LLM_API_KEY: 'k',
          AI_SCRIBE_STT_PRESET: 'openai',
        })
      )
    )
    const b = buildScribeAi(
      loadScribeAiConfig(
        env({ AI_SCRIBE_LLM_PRESET: 'ollama', AI_SCRIBE_STT_PRESET: 'whisper-server' })
      )
    )
    assert.equal(a.llm.describe().host, 'api.openai.com')
    assert.equal(a.llm.describe().location, 'external')
    assert.equal(b.llm.describe().host, '127.0.0.1')
    assert.equal(b.llm.describe().location, 'self-hosted')
    assert.equal(b.stt.describe().model, 'Systran/faster-whisper-small')
  })
})

describe('FR-13 production egress gate', () => {
  const openai = {
    AI_SCRIBE_LLM_PRESET: 'openai',
    AI_SCRIBE_LLM_API_KEY: 'k',
    AI_SCRIBE_STT_PRESET: 'openai',
  }

  it('an external host without a BAA entry is fatal; listing it in AI_SCRIBE_BAA_HOSTS clears it', () => {
    const blocked = fatal(prod(openai))
    assert.equal(blocked.length, 2) // LLM and STT
    assert.ok(blocked.every((m) => /api\.openai\.com, which is not in AI_SCRIBE_BAA_HOSTS/.test(m)))
    assert.deepEqual(
      fatal(prod({ ...openai, AI_SCRIBE_BAA_HOSTS: ' API.openai.com ,other.example ' })),
      []
    )
  })

  it('the Gemini Developer API is refused even when listed', () => {
    const vars = prod({
      AI_SCRIBE_LLM_PRESET: 'gemini',
      AI_SCRIBE_LLM_API_KEY: 'g',
      AI_SCRIBE_BAA_HOSTS: 'generativelanguage.googleapis.com',
    })
    assert.ok(fatal(vars).some((m) => /Gemini Developer API.*vertex-gemini/.test(m)))
  })

  it('plain http to a remote host is fatal', () => {
    const vars = prod({
      AI_SCRIBE_LLM_PRESET: 'custom',
      AI_SCRIBE_LLM_BASE_URL: 'http://llm.example.com/v1',
      AI_SCRIBE_LLM_MODEL: 'm',
      AI_SCRIBE_LLM_API_KEY: 'k',
      AI_SCRIBE_BAA_HOSTS: 'llm.example.com',
    })
    assert.ok(fatal(vars).some((m) => /must use https/.test(m)))
  })

  it('the mock provider is fatal in production only', () => {
    const vars = { AI_SCRIBE_LLM_PROVIDER: 'mock', AI_SCRIBE_STT_PROVIDER: 'mock' }
    assert.equal(fatal(prod(vars)).length, 2)
    assert.deepEqual(fatal(env(vars)), [])
  })

  it('self-hosted needs no BAA entry; plain http off-loopback is a warning, not fatal', () => {
    assert.deepEqual(
      fatal(prod({ AI_SCRIBE_LLM_PRESET: 'ollama', AI_SCRIBE_STT_PRESET: 'whisper-server' })),
      []
    )
    const lan = scribeEgressProblems(
      prod({ AI_SCRIBE_LLM_PRESET: 'ollama', AI_SCRIBE_LLM_BASE_URL: 'http://10.0.0.5:11434/v1' })
    )
    assert.ok(lan.some((p) => !p.fatal && /plain http to 10\.0\.0\.5/.test(p.message)))
  })

  it('AI_SCRIBE_PHI_POLICY=synthetic-data-only (hosted demo) downgrades only the BAA checks', () => {
    const demo = { AI_SCRIBE_PHI_POLICY: 'synthetic-data-only' }
    // No BAA entry / Gemini Developer API: allowed, but every boot says so.
    const problems = scribeEgressProblems(prod({ ...openai, ...demo }))
    assert.deepEqual(
      problems.filter((p) => p.fatal),
      []
    )
    assert.ok(
      problems.some((p) =>
        /synthetic data only — AI_SCRIBE_LLM sends PHI to api\.openai\.com/.test(p.message)
      )
    )
    assert.deepEqual(
      fatal(prod({ AI_SCRIBE_LLM_PRESET: 'gemini', AI_SCRIBE_LLM_API_KEY: 'g', ...demo })),
      []
    )
    // Transport and test-only problems stay fatal.
    const http = prod({
      AI_SCRIBE_LLM_PRESET: 'custom',
      AI_SCRIBE_LLM_BASE_URL: 'http://llm.example.com/v1',
      AI_SCRIBE_LLM_MODEL: 'm',
      AI_SCRIBE_LLM_API_KEY: 'k',
      ...demo,
    })
    assert.ok(fatal(http).some((m) => /must use https/.test(m)))
    assert.equal(fatal(prod({ AI_SCRIBE_LLM_PROVIDER: 'mock', ...demo })).length, 1)
    // Only the exact phrase counts.
    assert.equal(fatal(prod({ ...openai, AI_SCRIBE_PHI_POLICY: 'synthetic' })).length, 2)
  })

  it('is part of boot validation (collectEnvProblems)', () => {
    const problems = collectEnvProblems(prod(openai))
    assert.ok(problems.some((p) => p.fatal && /AI_SCRIBE_BAA_HOSTS/.test(p.message)))
  })

  it('classifies private hosts', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.4',
      '192.168.1.9',
      '::1',
      'ollama',
      'ai.internal',
      'fd00::1',
    ]) {
      assert.equal(isPrivateHost(h), true, h)
    }
    for (const h of [
      'api.openai.com',
      '8.8.8.8',
      '172.32.0.1',
      'generativelanguage.googleapis.com',
    ]) {
      assert.equal(isPrivateHost(h), false, h)
    }
  })
})

describe('demo flag (FR-16)', () => {
  it('on outside production, off in production unless set', () => {
    assert.equal(isScribeDemoEnabled(env({})), true)
    assert.equal(isScribeDemoEnabled(prod({})), false)
    assert.equal(isScribeDemoEnabled(prod({ AI_SCRIBE_DEMO_ENABLED: 'true' })), true)
    assert.equal(isScribeDemoEnabled(env({ AI_SCRIBE_DEMO_ENABLED: 'false' })), false)
  })
})
