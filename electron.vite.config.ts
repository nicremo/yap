import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/* The renderer never talks to the network itself (all requests go through
   main), so production pages get a strict policy. Development keeps Vite's
   inline refresh preamble working by skipping it. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'yap-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      sourcemap: true,
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        output: {
          format: 'cjs',
          inlineDynamicImports: true,
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), contentSecurityPolicy()],
    server: {
      port: 5174,
      strictPort: true,
    },
    build: {
      outDir: 'dist/renderer',
      minify: 'esbuild',
      rollupOptions: {
        input: path.resolve(rootDir, 'index.html'),
      },
    },
  },
});
