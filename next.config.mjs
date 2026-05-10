/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Enable src/instrumentation.ts boot hook (Next 14). Stable in Next 15.
    instrumentationHook: true,
  },
};

export default nextConfig;
