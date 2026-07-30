import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    // Windows 上运行中的静态服务可能占用输出目录，使用稳定文件名覆盖可安全重复构建。
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => (
          assetInfo.name?.endsWith('.css') ? 'assets/app.css' : 'assets/[name][extname]'
        ),
      },
    },
  },
});
