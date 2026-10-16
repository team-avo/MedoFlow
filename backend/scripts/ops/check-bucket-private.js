#!/usr/bin/env node
/**
 * B3.1 — object-storage posture check for the patient-files bucket, run with
 * the API's S3_* settings (e.g. `node --env-file=.env scripts/ops/check-bucket-private.js`):
 *
 *  1. writes a synthetic probe object (with the configured SSE),
 *  2. an anonymous GET of that object is refused (403/400/401, never 200),
 *  3. a presigned GET (60 s) succeeds and returns the exact bytes,
 *  4. a tampered presigned GET is refused,
 *  5. reports the bucket's public-access block and the object's encryption
 *     when the store supports those APIs (AWS S3; R2 encrypts every object
 *     at rest and has no public-access-block API),
 *  6. deletes the probe and confirms it is gone.
 *
 * Exits 1 if any required check fails. Prints no credentials.
 */
const crypto = require('crypto')
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetPublicAccessBlockCommand,
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

const env = process.env
if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
  console.error('S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set')
  process.exit(1)
}
const bucket = env.S3_FILES_BUCKET || env.S3_BUCKET || 'medoflow-files'
const sse = (env.S3_SSE || 'AES256').trim()
const client = new S3Client({
  region: env.S3_REGION || 'us-east-1',
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT, forcePathStyle: true }),
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const info = (name, detail) => console.log(`INFO  ${name}  (${detail})`)

async function main() {
  const key = `posture-check/${crypto.randomUUID()}`
  const body = Buffer.from(`synthetic posture probe ${new Date().toISOString()}`)
  const sseParams =
    sse === 'provider-default'
      ? {}
      : sse === 'aws:kms'
        ? {
            ServerSideEncryption: 'aws:kms',
            ...(env.S3_SSE_KMS_KEY_ID && { SSEKMSKeyId: env.S3_SSE_KMS_KEY_ID }),
          }
        : { ServerSideEncryption: 'AES256' }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'text/plain',
      ...sseParams,
    })
  )
  console.log(`bucket=${bucket} sse=${sse}`)

  const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 60,
  })
  const unsigned = signed.split('?')[0]
  const anon = await fetch(unsigned)
  check('anonymous GET is refused', anon.status !== 200, `HTTP ${anon.status}`)

  const presigned = await fetch(signed)
  const bytes = Buffer.from(await presigned.arrayBuffer())
  check(
    'presigned GET works',
    presigned.status === 200 && bytes.equals(body),
    `HTTP ${presigned.status}`
  )

  const tampered = await fetch(
    signed.replace(/X-Amz-Signature=[0-9a-f]{4}/, 'X-Amz-Signature=0000')
  )
  check('tampered presigned GET is refused', tampered.status !== 200, `HTTP ${tampered.status}`)

  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    info('object encryption', head.ServerSideEncryption || 'not reported (provider default)')
    if (sse !== 'provider-default') {
      check(
        'object encrypted as configured',
        head.ServerSideEncryption === sse,
        head.ServerSideEncryption
      )
    }
  } catch (e) {
    info('object encryption', `HEAD failed: ${e.name}`)
  }

  try {
    const pab = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))
    const c = pab.PublicAccessBlockConfiguration || {}
    check(
      'public access block fully on',
      !!(c.BlockPublicAcls && c.IgnorePublicAcls && c.BlockPublicPolicy && c.RestrictPublicBuckets),
      JSON.stringify(c)
    )
  } catch (e) {
    info(
      'public access block',
      `not supported by this store (${e.name}) — rely on the anonymous GET check`
    )
  }

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  const gone = await fetch(signed)
  check('probe deleted', gone.status === 404 || gone.status === 403, `HTTP ${gone.status}`)

  if (results.some((r) => !r.pass)) process.exit(1)
}

main().catch((err) => {
  console.error(`check failed: ${err.name}: ${err.message}`)
  process.exit(1)
})
