#!/usr/bin/env node
/**
 * B0.6.2 — TLS scan: each host must accept TLS 1.2 and 1.3 and refuse 1.0
 * and 1.1, and send HSTS.
 *
 *   node scripts/ops/tls-check.js medoflow-backend-6pd5.onrender.com medoflow-web.advertout-medoflow.workers.dev
 */
const tls = require('tls')
const https = require('https')

const probe = (host, version) =>
  new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        minVersion: version,
        maxVersion: version,
        // Allow the legacy protocols on the client side so the *server* decides.
        ciphers: 'DEFAULT:@SECLEVEL=0',
        timeout: 8000,
      },
      () => {
        resolve({ ok: true, protocol: socket.getProtocol() })
        socket.end()
      }
    )
    socket.on('error', (err) => resolve({ ok: false, error: err.code || err.message }))
    socket.on('timeout', () => {
      resolve({ ok: false, error: 'timeout' })
      socket.destroy()
    })
  })

const hsts = (host) =>
  new Promise((resolve) => {
    https
      .get({ host, path: '/', headers: { 'user-agent': 'medoflow-tls-check' } }, (res) => {
        resolve(res.headers['strict-transport-security'] || null)
        res.resume()
      })
      .on('error', () => resolve(null))
  })

;(async () => {
  let failed = false
  for (const host of process.argv.slice(2)) {
    console.log(`\n${host}`)
    for (const [version, mustAccept] of [
      ['TLSv1', false],
      ['TLSv1.1', false],
      ['TLSv1.2', true],
      ['TLSv1.3', true],
    ]) {
      const r = await probe(host, version)
      const pass = r.ok === mustAccept
      if (!pass) failed = true
      console.log(
        `  ${pass ? '✓' : '✗'} ${version.padEnd(8)} ${r.ok ? `accepted (${r.protocol})` : `refused (${r.error})`}`
      )
    }
    const h = await hsts(host)
    if (!h) failed = true
    console.log(`  ${h ? '✓' : '✗'} HSTS ${h ?? 'missing'}`)
  }
  process.exit(failed ? 1 : 0)
})()
