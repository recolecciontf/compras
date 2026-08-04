import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/server",
    emptyOutDir: false,
    minify: true,
    target: "es2022",
    lib: {
      entry: "worker/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
  },
});
