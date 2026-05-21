import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      // Rewrite `./api` imports to `./api.demo` in source files
      name: "demo-api-redirect",
      enforce: "pre",
      transform(code, id) {
        if (/\.(jsx?|tsx?)$/.test(id) && /from ["']\.\/api["']/.test(code)) {
          return code.replace(/from (["'])\.\/api\1/g, "from './api.demo'");
        }
      },
    },
  ],
  // No proxy — all API calls are handled by the in-memory mock
});
