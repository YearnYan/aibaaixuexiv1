import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    // Windows 上运行过静态服务后可能暂时占用旧产物；哈希文件可安全并存。
    emptyOutDir: false,
  },
});
