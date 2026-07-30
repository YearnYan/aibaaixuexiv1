import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "/",
  root: fileURLToPath(new URL("./src", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./src/index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./src/admin.html", import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pdfjs-dist")) {
            return "pdf";
          }
          if (id.includes("node_modules/react-markdown")
            || id.includes("node_modules/remark-")
            || id.includes("node_modules/rehype-")
            || id.includes("node_modules/katex")) {
            return "math-markdown";
          }
          if (id.includes("node_modules/mammoth")) {
            return "word-reader";
          }
          if (id.includes("node_modules/docx")
            || id.includes("node_modules/jszip")
            || id.includes("node_modules/mathjax-full")
            || id.includes("node_modules/mathml2omml")) {
            return "word-export";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8791",
        changeOrigin: true,
      },
    },
  },
});
