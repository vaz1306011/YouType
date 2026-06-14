import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/transcript": "http://localhost:8000",
      "/search_lyrics": "http://localhost:8000",
      "/apply_lyrics": "http://localhost:8000",
      "/apply_auto_cc": "http://localhost:8000",
    },
  },
});
