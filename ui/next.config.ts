import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

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

export default withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      // Rezeptliste: Network First, 24h Cache-Fallback
      {
        urlPattern: /\/api\/recipes$/,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-recipes",
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      // Rezept-Detail: Network First, 7 Tage Cache-Fallback
      {
        urlPattern: /\/api\/recipes\/\d+/,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-recipe-detail",
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      // Eigene Upload-Bilder: Cache First, 30 Tage
      {
        urlPattern: /\/uploads\//,
        handler: "CacheFirst",
        options: {
          cacheName: "recipe-images",
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      // Unsplash Fallback-Bilder: Cache First, 30 Tage
      {
        urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "unsplash-images",
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
})(nextConfig);