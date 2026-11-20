import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Supports both the repository's GitHub Pages project path and local hosting.
  base: "./",
  plugins: [react()]
});
