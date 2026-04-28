import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  eslint: { ignoreDuringBuilds: true },
};
export default config;
