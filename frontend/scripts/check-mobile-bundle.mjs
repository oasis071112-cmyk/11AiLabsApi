import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectDir, 'dist')
const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')

const entryScript = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
const entryStyle = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1]

if (!entryScript || !entryStyle) {
  throw new Error('生产构建缺少首屏 JS 或 CSS 入口')
}

const assetSize = (publicPath) => fs.statSync(path.join(distDir, publicPath.replace(/^\//, ''))).size
const scriptBytes = assetSize(entryScript)
const styleBytes = assetSize(entryStyle)
const oversizedElementBundle = fs.readdirSync(path.join(distDir, 'assets'))
  .find((name) => /^element-plus-.*\.js$/.test(name))
const preloadedChartBundle = html.match(/<link[^>]+rel="modulepreload"[^>]+href="[^"]*(?:echarts|chart)[^"]*"/i)?.[0]

if (oversizedElementBundle) {
  throw new Error(`手机首屏不允许整包加载 Element Plus：${oversizedElementBundle}`)
}
if (preloadedChartBundle) {
  throw new Error(`登录首屏不允许预加载图表依赖：${preloadedChartBundle}`)
}
if (scriptBytes > 250_000) {
  throw new Error(`手机首屏入口 JS 超过 250 KB：${scriptBytes} bytes`)
}
if (styleBytes > 100_000) {
  throw new Error(`手机首屏入口 CSS 超过 100 KB：${styleBytes} bytes`)
}

console.log(`手机首屏体积通过：JS ${scriptBytes} bytes，CSS ${styleBytes} bytes`)
