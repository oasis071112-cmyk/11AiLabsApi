import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath } from 'url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:3300'
  const manualChunks = id => {
    const moduleId = id.replace(/\\/g, '/')
    if (!moduleId.includes('/node_modules/')) return undefined
    if (/(?:^|\/)(?:vue|vue-router|pinia)(?:\/|$)|\/@vue\/runtime-|\/@vue\/shared\//.test(moduleId)) return 'vendor-vue'
    return undefined
  }

  return {
    plugins: [
      vue(),
      AutoImport({ resolvers: [ElementPlusResolver()] }),
      Components({ resolvers: [ElementPlusResolver()] })
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5173, proxy: { '/api': proxyTarget, '/v1': proxyTarget } },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      minify: 'terser',
      rollupOptions: { output: { manualChunks } }
    }
  }
})
