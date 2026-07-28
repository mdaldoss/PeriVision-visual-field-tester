import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base path is overridable so the same build works on GitHub Pages
// (/<repo>/) and on a root-hosted domain.
const base = process.env.PERIVISION_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
