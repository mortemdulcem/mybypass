import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const libarchiveDir = resolve(process.cwd(), "node_modules/libarchive.js/dist");
const libarchiveWorker = resolve(libarchiveDir, "worker-bundle.js");
const libarchiveWasm = resolve(libarchiveDir, "libarchive.wasm");

/**
 * libarchive.js worker and WASM asset delivery
 */
function libarchiveAssets(): Plugin {
  return {
    name: "local-libarchive-assets",
    configureServer(server: ViteDevServer) {
      const base = server.config.base.endsWith("/")
        ? server.config.base
        : `${server.config.base}/`;
      server.middlewares.use(`${base}libarchive/worker-bundle.js`, (_request, response, next) => {
        if (existsSync(libarchiveWorker)) {
          response.setHeader("Content-Type", "text/javascript");
          response.end(readFileSync(libarchiveWorker));
        } else {
          next();
        }
      });
      server.middlewares.use(`${base}libarchive/libarchive.wasm`, (_request, response, next) => {
        if (existsSync(libarchiveWasm)) {
          response.setHeader("Content-Type", "application/wasm");
          response.end(readFileSync(libarchiveWasm));
        } else {
          next();
        }
      });
    },
    generateBundle() {
      if (existsSync(libarchiveWorker)) {
        this.emitFile({ type: "asset", fileName: "libarchive/worker-bundle.js", source: readFileSync(libarchiveWorker) });
      }
      if (existsSync(libarchiveWasm)) {
        this.emitFile({ type: "asset", fileName: "libarchive/libarchive.wasm", source: readFileSync(libarchiveWasm) });
      }
    },
  };
}

/**
 * Clean API middleware providing runtime status for AI/ML and anatomy pipelines
 */
function localModelJobApi(): Plugin {
  return {
    name: "local-pretrained-model-jobs",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/model-jobs", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          status: "offline",
          available: false,
          message: "Yerel GPU/Python model sunucusu bağlı değil. Bağımsız tarayıcı modunda çalışıyor."
        }));
      });
      server.middlewares.use("/api/anatomy", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          status: "offline",
          available: false,
          message: "Yerel anatomi modeli hazır değil. Manuel ve yarı-otomatik morfometri aktif."
        }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), libarchiveAssets(), localModelJobApi()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
  preview: { host: "0.0.0.0", port: 3000, allowedHosts: true },
});
