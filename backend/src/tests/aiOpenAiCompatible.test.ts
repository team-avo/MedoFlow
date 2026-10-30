/**
 * B2.1 / FR-12 — the OpenAI-compatible adapter against a local HTTP stub.
 * Proves the request shapes for each vendor style (OpenAI json_schema, Groq /
 * Ollama json_object, Azure api-key, Gemini chat-audio), and that failures
 * become safe AiError codes that never carry provider text, keys or hosts.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  OpenAiCompatibleLlm,
  OpenAiCompatibleStt,
  audioExtension,
} from '../services/ai/openaiCompatible'
import { AiError } from '../services/ai/errors'
import type { LlmConfig, SttConfig } from '../services/ai/config'

interface Captured {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: Buffer
}

let server: http.Server
let base = ''
let captured: Captured[] = []
let reply: (req: Captured, res: http.ServerResponse) => void = () => {}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const c: Captured = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      }
      captured.push(c)
      reply(c, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  captured = []
  reply = (_req, res) =>
    json(res, 200, { model: 'served-model', choices: [{ message: { content: '{"ok":true}' } }] })
})

const llmCfg = (over: Partial<LlmConfig> = {}): LlmConfig => ({
  kind: 'openai-compatible',
  preset: 'openai',
  baseUrl: base,
  apiKey: 'sk-test-SECRETKEY',
  model: 'gpt-test',
  auth: 'bearer',
  jsonMode: 'json_schema',
  ...over,
})

const sttCfg = (over: Partial<SttConfig> = {}): SttConfig => ({
  kind: 'openai-compatible',
  preset: 'openai',
  baseUrl: base,
  apiKey: 'sk-test-SECRETKEY',
  model: 'whisper-test',
  auth: 'bearer',
  mode: 'transcriptions',
  ...over,
})

const deps = { timeoutMs: 5_000 }
const schema = { name: 'scribe_analysis', schema: { type: 'object', properties: {} } }

async function rejectsWith(p: Promise<unknown>, code: string): Promise<AiError> {
  try {
    await p
  } catch (e) {
    assert.ok(e instanceof AiError, `expected AiError, got ${String(e)}`)
    assert.equal(e.code, code)
    return e
  }
  throw new Error(`expected rejection with ${code}`)
}

describe('LLM: /chat/completions', () => {
  it('sends system + user, bearer auth and a json_schema response_format (OpenAI / Gemini style)', async () => {
    const llm = new OpenAiCompatibleLlm(llmCfg(), deps)
    const res = await llm.complete({ system: 'SYS', user: 'USER', jsonSchema: schema })
    assert.deepEqual(res, { text: '{"ok":true}', model: 'served-model' })

    const [req] = captured
    assert.equal(req!.method, 'POST')
    assert.equal(req!.url, '/v1/chat/completions')
    assert.equal(req!.headers.authorization, 'Bearer sk-test-SECRETKEY')
    const body = JSON.parse(req!.body.toString()) as Record<string, any>
    assert.equal(body.model, 'gpt-test')
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ])
    assert.equal(body.response_format.type, 'json_schema')
    assert.equal(body.response_format.json_schema.name, 'scribe_analysis')
    assert.deepEqual(body.response_format.json_schema.schema, schema.schema)
  })

  it('falls back to json_object where the provider cannot take a schema (Groq / Ollama style)', async () => {
    const llm = new OpenAiCompatibleLlm(
      llmCfg({ jsonMode: 'json_object', auth: 'none', apiKey: '' }),
      deps
    )
    await llm.complete({ system: 'S', user: 'U', jsonSchema: schema })
    const [req] = captured
    assert.equal(req!.headers.authorization, undefined)
    assert.deepEqual(JSON.parse(req!.body.toString()).response_format, { type: 'json_object' })
  })

  it('asks for no response_format for plain text, or when JSON mode is off', async () => {
    await new OpenAiCompatibleLlm(llmCfg(), deps).complete({ system: 'S', user: 'U' })
    await new OpenAiCompatibleLlm(llmCfg({ jsonMode: 'none' }), deps).complete({
      system: 'S',
      user: 'U',
      json: true,
    })
    for (const req of captured) {
      assert.equal(JSON.parse(req.body.toString()).response_format, undefined)
    }
  })

  it("uses Azure's api-key header", async () => {
    await new OpenAiCompatibleLlm(llmCfg({ auth: 'api-key', preset: 'azure' }), deps).complete({
      system: 'S',
      user: 'U',
    })
    const [req] = captured
    assert.equal(req!.headers['api-key'], 'sk-test-SECRETKEY')
    assert.equal(req!.headers.authorization, undefined)
  })

  it('reads OpenAI-style content parts', async () => {
    reply = (_req, res) =>
      json(res, 200, {
        choices: [
          { message: { content: [{ type: 'text', text: 'part-a ' }, { text: 'part-b' }] } },
        ],
      })
    const res = await new OpenAiCompatibleLlm(llmCfg(), deps).complete({ system: 'S', user: 'U' })
    assert.equal(res.text, 'part-a part-b')
    assert.equal(res.model, 'gpt-test')
  })

  it('an empty answer is ai_bad_output', async () => {
    reply = (_req, res) => json(res, 200, { choices: [{ message: { content: '   ' } }] })
    await rejectsWith(
      new OpenAiCompatibleLlm(llmCfg(), deps).complete({ system: 'S', user: 'U' }),
      'ai_bad_output'
    )
  })
})

describe('failures become safe codes', () => {
  const cases: Array<[number, string, boolean]> = [
    [401, 'ai_auth', false],
    [403, 'ai_auth', false],
    [400, 'ai_rejected', false],
    [413, 'ai_rejected', false],
    [429, 'ai_rate_limited', true],
    [500, 'ai_unavailable', true],
    [503, 'ai_unavailable', true],
    [504, 'ai_timeout', true],
  ]
  for (const [status, code, retryable] of cases) {
    it(`HTTP ${status} → ${code} (retryable: ${retryable}), with no provider text in the message`, async () => {
      // A provider error body that echoes the prompt (PHI) and internals.
      reply = (_req, res) =>
        json(res, status, { error: { message: 'PATIENT-JANE-ECHO internal-host-xyz' } })
      const err = await rejectsWith(
        new OpenAiCompatibleLlm(llmCfg(), deps).complete({ system: 'S', user: 'PATIENT-JANE' }),
        code
      )
      assert.equal(err.retryable, retryable)
      assert.equal(err.providerStatus, status)
      for (const leak of ['PATIENT-JANE', 'internal-host-xyz', 'SECRETKEY', '127.0.0.1', base]) {
        assert.ok(!err.message.includes(leak), `message leaked "${leak}"`)
      }
    })
  }

  it('a request that outlives the timeout is aborted as ai_timeout', async () => {
    reply = (_req, res) => {
      setTimeout(() => json(res, 200, { choices: [{ message: { content: 'late' } }] }), 1_500)
    }
    const started = Date.now()
    await rejectsWith(
      new OpenAiCompatibleLlm(llmCfg(), { timeoutMs: 200 }).complete({ system: 'S', user: 'U' }),
      'ai_timeout'
    )
    assert.ok(Date.now() - started < 1_200, 'the request was not cancelled')
  })

  it("the caller's signal also cancels (job timeout)", async () => {
    reply = (_req, res) => {
      setTimeout(() => json(res, 200, { choices: [{ message: { content: 'late' } }] }), 1_500)
    }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    await rejectsWith(
      new OpenAiCompatibleLlm(llmCfg(), deps).complete(
        { system: 'S', user: 'U' },
        { signal: controller.signal }
      ),
      'ai_timeout'
    )
  })

  it('an unreachable host is ai_unavailable (retryable)', async () => {
    const err = await rejectsWith(
      new OpenAiCompatibleLlm(llmCfg({ baseUrl: 'http://127.0.0.1:1/v1' }), deps).complete({
        system: 'S',
        user: 'U',
      }),
      'ai_unavailable'
    )
    assert.equal(err.retryable, true)
  })
})

describe('STT', () => {
  const audio = Buffer.from('synthetic-webm-bytes')

  it('mode transcriptions: multipart POST /audio/transcriptions with the file, model and language', async () => {
    reply = (_req, res) => json(res, 200, { text: ' Provider: hello. ' })
    const stt = new OpenAiCompatibleStt(sttCfg(), deps)
    const res = await stt.transcribe({ audio, mimeType: 'audio/webm;codecs=opus', language: 'en' })
    assert.deepEqual(res, { text: 'Provider: hello.', model: 'whisper-test' })

    const [req] = captured
    assert.equal(req!.url, '/v1/audio/transcriptions')
    assert.match(String(req!.headers['content-type']), /^multipart\/form-data; boundary=/)
    const body = req!.body.toString()
    assert.match(body, /name="file"; filename="consultation\.webm"/)
    assert.match(body, /Content-Type: audio\/webm/)
    assert.ok(body.includes('synthetic-webm-bytes'))
    assert.match(body, /name="model"\r\n\r\nwhisper-test/)
    assert.match(body, /name="language"\r\n\r\nen/)
  })

  it('mode chat-audio (Gemini): base64 audio as an input_audio content part', async () => {
    reply = (_req, res) =>
      json(res, 200, { model: 'gemini-x', choices: [{ message: { content: 'Patient: tired.' } }] })
    const stt = new OpenAiCompatibleStt(
      sttCfg({ mode: 'chat-audio', preset: 'gemini', model: 'gemini-x' }),
      deps
    )
    const res = await stt.transcribe({ audio, mimeType: 'audio/wav' })
    assert.deepEqual(res, { text: 'Patient: tired.', model: 'gemini-x' })

    const [req] = captured
    assert.equal(req!.url, '/v1/chat/completions')
    const body = JSON.parse(req!.body.toString()) as Record<string, any>
    const part = body.messages[1].content.find((p: { type: string }) => p.type === 'input_audio')
    assert.deepEqual(part.input_audio, { data: audio.toString('base64'), format: 'wav' })
    assert.equal(body.temperature, 0)
  })

  it('empty audio is refused without a request', async () => {
    await rejectsWith(
      new OpenAiCompatibleStt(sttCfg(), deps).transcribe({
        audio: Buffer.alloc(0),
        mimeType: 'audio/webm',
      }),
      'ai_rejected'
    )
    assert.equal(captured.length, 0)
  })

  it('a response without text is ai_bad_output', async () => {
    reply = (_req, res) => json(res, 200, { text: '' })
    await rejectsWith(
      new OpenAiCompatibleStt(sttCfg(), deps).transcribe({ audio, mimeType: 'audio/webm' }),
      'ai_bad_output'
    )
  })

  it('maps MIME types to file extensions', () => {
    assert.equal(audioExtension('audio/webm;codecs=opus'), 'webm')
    assert.equal(audioExtension('audio/mpeg'), 'mp3')
    assert.equal(audioExtension('audio/x-wav'), 'wav')
    assert.equal(audioExtension('audio/mp4'), 'm4a')
    assert.equal(audioExtension('audio/unknown'), 'webm')
  })
})

describe('provider descriptor (provenance)', () => {
  it('names the host only, and marks loopback as self-hosted', () => {
    const d = new OpenAiCompatibleLlm(llmCfg(), deps).describe()
    assert.deepEqual(d, {
      kind: 'openai-compatible',
      preset: 'openai',
      host: '127.0.0.1',
      model: 'gpt-test',
      location: 'self-hosted',
    })
    const ext = new OpenAiCompatibleLlm(
      llmCfg({ baseUrl: 'https://api.openai.com/v1' }),
      deps
    ).describe()
    assert.equal(ext.location, 'external')
    assert.equal(ext.host, 'api.openai.com')
    assert.ok(!JSON.stringify(ext).includes('SECRETKEY'))
  })
})
