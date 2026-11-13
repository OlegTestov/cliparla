import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        // Don't externalize electron-store as it's ESM-only
        exclude: ['electron-store']
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        external: ['electron']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@resources': resolve(__dirname, 'resources')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          setup: resolve(__dirname, 'src/renderer/setup.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          result: resolve(__dirname, 'src/renderer/result.html'),
          listening: resolve(__dirname, 'src/renderer/listening.html'),
          permissions: resolve(__dirname, 'src/renderer/permissions.html'),
          toast: resolve(__dirname, 'src/renderer/toast.html')
        }
      }
    }
  }
})
