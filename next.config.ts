import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for self-hosting (VPS, DigitalOcean, etc)
  output: 'standalone',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
