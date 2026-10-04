import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1" },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules") &&
            (id.includes("/konva/") ||
              id.includes("/react-konva/") ||
              id.includes("/react-reconciler/"))
          )
            return "canvas";
          if (id.includes("node_modules") && id.includes("@mantine"))
            return "ui";
        },
      },
    },
  },
});
