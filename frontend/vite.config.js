import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// React 16 predates the automatic JSX runtime being the default, so the classic
// transform is used and every JSX file imports React explicitly.
export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'classic',
    }),
  ],
  server: {
    port: 5173,
    strictPort: false,
    watch: {
      // Native file events are unreliable inside OneDrive and other synced or
      // network folders, which silently breaks hot reload. Polling costs a
      // little CPU and makes edits show up reliably.
      usePolling: true,
      interval: 300,
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
