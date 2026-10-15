const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pnpm workspace: dependencies live in the repo-root node_modules, so file
  // tracing (used by the Cloudflare/OpenNext build) must start from the root.
  outputFileTracingRoot: path.join(__dirname, '..'),
  async redirects() {
    return [
      // Phase 2: killed /dashboard/patient/* — patients live on /account/*
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
