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
};
export default config;
