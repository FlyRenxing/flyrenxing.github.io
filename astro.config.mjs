import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // 静态输出，用于 GitHub Pages
  output: 'static',

  // 图片优化配置
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        limitInputPixels: false,
      },
    },
    // 图片优化配置
    domains: [],
  },

  // 集成
  integrations: [
    mdx(),
    react(),
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],

  // 构建选项
  build: {
    format: 'file',
    // 内联小于 4KB 的资源
    inlineStylesheets: 'auto',
  },

  // 站点配置
  site: 'https://flyrenxing.github.io',
});