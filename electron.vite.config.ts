import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load `.env` (gitignored) so build-time secrets stay out of source/git. The
  // empty-prefix arg loads non-`VITE_`-prefixed keys too. We pick only the one
  // key we need and bake it into the MAIN bundle via `define`, so the literal
  // never lives in source. Fresh clones with no `.env` build cleanly (empty
  // string) — only the Gemini Google-login refresh is then disabled.
  const env = loadEnv(mode, process.cwd(), '')
  const iosRemoteEnabled = process.env.IOS_REMOTE_TRUE === '1' || env.IOS_REMOTE_TRUE === '1'
  return {
    main: {
      define: {
        'process.env.GEMINI_OAUTH_CLIENT_SECRET': JSON.stringify(
          env.GEMINI_OAUTH_CLIENT_SECRET ?? ''
        )
      }
    },
    preload: {},
    renderer: {
      define: {
        __IOS_REMOTE_TRUE__: JSON.stringify(iosRemoteEnabled)
      },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [react()]
    }
  }
})
