import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/global.css'
import './styles/user-openai-theme.css'

requestAnimationFrame(() => {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)
  requestAnimationFrame(() => app.mount('#app'))
})
