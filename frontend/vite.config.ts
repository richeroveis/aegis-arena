import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is the repo name so all assets resolve cleanly under GitHub Pages.
export default defineConfig({
  base: "/aegis-arena/",
  plugins: [react()],
  server: { port: 5173 },
});
