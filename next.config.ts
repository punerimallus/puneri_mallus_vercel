import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 1. Force modern formats (WebP is fast, AVIF is even smaller)
    formats: ['image/avif', 'image/webp'],
    
    // 2. Optimization settings
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'bhfrgcphqmbocplfcvbg.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  skipTrailingSlashRedirect: true, 
};

export default nextConfig;