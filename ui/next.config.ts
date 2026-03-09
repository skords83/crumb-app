import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      // Dein eigener VPS (uploads)
      { protocol: 'https', hostname: 'crumb.skords.de' },
      // Unsplash Fallback-Bilder
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // Häufige Quellen aus Scraper-Importen
      { protocol: 'https', hostname: '**.wordpress.com' },
      { protocol: 'https', hostname: '**.wp.com' },
      { protocol: 'https', hostname: 'ploetzblog.de' },
      { protocol: 'https', hostname: '**.ploetzblog.de' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;