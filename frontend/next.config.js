const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pnpm workspace: dependencies live in the repo-root node_modules, so file
  // tracing (used by the Cloudflare/OpenNext build) must start from the root.
  outputFileTracingRoot: path.join(__dirname, '..'),
  async redirects() {
    return [
      // CTO-02: the old "Video Room" tab is gone. The path remains the Google
      // OAuth callback (it carries ?code); any other visit goes to Appointments.
      {
        source: '/dashboard/provider/meetings',
        missing: [{ type: 'query', key: 'code' }],
        destination: '/dashboard/appointments',
        permanent: false,
      },
      // Phase 2: killed /dashboard/patient/*, patients live on /account/*
      {
        source: '/dashboard/patient',
        destination: '/account',
        permanent: false,
      },
      {
        source: '/dashboard/patient/appointments',
        destination: '/account/appointments',
        permanent: false,
      },
      {
        source: '/dashboard/patient/appointments/:id',
        destination: '/account/appointments/:id',
        permanent: false,
      },
      {
        source: '/dashboard/patient/billing',
        destination: '/account/billing',
        permanent: false,
      },
      {
        source: '/dashboard/patient/waitlist',
        destination: '/account/appointments',
        permanent: false,
      },
      {
        source: '/dashboard/patient/consultation/:token',
        destination: '/consultation/:token',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
