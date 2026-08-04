import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import './styles/global.css'
import './styles/user-openai-theme.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
const authStore = useAuthStore(pinia)
if (authStore.token) void authStore.checkAuth()
app.use(router)
app.mount('#app')
