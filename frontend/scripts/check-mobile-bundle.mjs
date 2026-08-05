import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectDir, 'dist')
const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')

const entryScript = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
const entryStyle = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1]
const vueRuntimePreload = html.match(/<link[^>]+rel="modulepreload"[^>]+href="[^"]*vendor-vue-[^"]+\.js"/)?.[0]

if (!entryScript || !entryStyle) {
  throw new Error('生产构建缺少首屏 JS 或 CSS 入口')
}
if (!html.includes('data-app-boot')) {
  throw new Error('生产 HTML 缺少网络较慢时的首屏加载界面')
}
if (!vueRuntimePreload) {
  throw new Error('生产 HTML 缺少 Vue 核心运行时的 modulepreload')
}
if (html.indexOf(`src="${entryScript}"`) > html.indexOf('</head>')) {
  throw new Error('生产入口 JS 必须在 head 中尽早发现')
}

const assetSize = (publicPath) => fs.statSync(path.join(distDir, publicPath.replace(/^\//, ''))).size
const scriptBytes = assetSize(entryScript)
const styleBytes = assetSize(entryStyle)
const oversizedElementBundle = fs.readdirSync(path.join(distDir, 'assets'))
  .find((name) => /^element-plus-.*\.js$/.test(name))
const preloadedChartBundle = html.match(/<link[^>]+rel="modulepreload"[^>]+href="[^"]*(?:echarts|chart)[^"]*"/i)?.[0]
const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
const staleChartDependency = ['vue-echarts', 'echarts-liquidfill'].find((name) => packageJson.dependencies?.[name])

if (oversizedElementBundle) {
  throw new Error(`手机首屏不允许整包加载 Element Plus：${oversizedElementBundle}`)
}
if (preloadedChartBundle) {
  throw new Error(`登录首屏不允许预加载图表依赖：${preloadedChartBundle}`)
}
if (staleChartDependency) {
  throw new Error(`前端依赖仍包含已废弃的用户图表包：${staleChartDependency}`)
}
if (scriptBytes > 250_000) {
  throw new Error(`手机首屏入口 JS 超过 250 KB：${scriptBytes} bytes`)
}
if (styleBytes > 100_000) {
  throw new Error(`手机首屏入口 CSS 超过 100 KB：${styleBytes} bytes`)
}

console.log(`手机首屏体积通过：JS ${scriptBytes} bytes，CSS ${styleBytes} bytes`)
