import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  eslint: { ignoreDuringBuilds: true },
  // lib/rag/reva.ts reads knowledge-base/reva/SKILL.md at runtime from the repo
  // root, which is outside this app directory. Without tracing it explicitly it
  // is absent from the serverless bundle, and Reva throws on every request in
  // deploy even though it resolves fine locally.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  outputFileTracingIncludes: {
    '/api/reva': ['../../knowledge-base/reva/SKILL.md'],
  },
  // Switch-over to the Research Hub (2026-10-09): old pages point at their
  // replacements. Query strings carry over (/chat?q=... -> /ask?q=...).
  // Permanent (308) so bookmarks update.
  async redirects() {
    return [
      { source: '/chat', destination: '/ask', permanent: true },
      { source: '/reports/limits', destination: '/coa/standard', permanent: true },
      { source: '/reports/assign', destination: '/admin', permanent: true },
      { source: '/reports/:path*', destination: '/coa', permanent: true },
      { source: '/bibliography', destination: '/library', permanent: true },
      { source: '/audit', destination: '/claims/check', permanent: true },
      { source: '/atlas', destination: '/library/topics', permanent: true },
    ];
  },
};
export default config;
