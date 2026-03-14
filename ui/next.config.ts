import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'crumb.skords.de' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: '**.wordpress.com' },
      { protocol: 'https', hostname: '**.wp.com' },
      { protocol: 'https', hostname: 'ploetzblog.de' },
      { protocol: 'https', hostname: '**.ploetzblog.de' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;