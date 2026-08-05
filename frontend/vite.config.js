import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath } from 'url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:3300'
  const vendorVueModules = /[\\/]node_modules[\\/](?:(?:vue|vue-router|pinia)[\\/]|@vue[\\/])/
  const vendorIconModules = /[\\/]node_modules[\\/]@lucide[\\/]vue[\\/]/
  const vendorElementModules = /[\\/]node_modules[\\/](?:(?:element-plus|async-validator|lodash-es|lodash-unified|memoize-one|normalize-wheel-es)[\\/]|@(?:element-plus|ctrl[\\/]tinycolor|floating-ui|sxzz[\\/]popperjs-es|vueuse)[\\/])/

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
      rolldownOptions: {
        output: {
          codeSplitting: {
            includeDependenciesRecursively: false,
            groups: [
              { name: 'vendor-vue', test: vendorVueModules, priority: 20 },
              { name: 'vendor-icons', test: vendorIconModules, priority: 15 },
              { name: 'vendor-element', test: vendorElementModules, priority: 10 },
            ],
          },
        },
      },
    }
  }
})
