/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output so the SPCS container image stays small.
  output: 'standalone',
  reactStrictMode: true,
  // snowflake-sdk is a native-ish Node package: keep it external to the
  // server bundle so Next does not try to trace/bundle its dynamic requires.
  serverExternalPackages: ['snowflake-sdk', '@prisma/client', 'canvas', 'vega-canvas'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
