import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Keep built assets relative so the same dist works on GitHub Pages and
  // hosts that mount the app at a generated or nested deployment path.
  base: "./",
  plugins: [react()]
});
