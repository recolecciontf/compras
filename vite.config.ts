import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The native resolver can miss these entrypoints on Windows. Use the installed
// packages' own entrypoints, retaining Lucide's tree-shakeable ES module.
const require = createRequire(import.meta.url);
const windowsAliases = process.platform === "win32" ? [
  ...["react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client", "react-dom", "react"].map(name => ({
    find: new RegExp(`^${name}$`), replacement: require.resolve(name).replace(/\\/g, "/"),
  })),
  (() => {
    const file = require.resolve("lucide-react/package.json");
    return { find: /^lucide-react$/, replacement: resolve(dirname(file), JSON.parse(readFileSync(file, "utf8")).module).replace(/\\/g, "/") };
  })(),
] : [];

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: windowsAliases },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
