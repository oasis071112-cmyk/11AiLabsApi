import { createRouter, createWebHistory } from 'vue-router'
const routes=[
  {path:'/login',name:'Login',component:()=>import('@/views/auth/Login.vue'),meta:{guest:true}},
  {path:'/register',name:'Register',component:()=>import('@/views/auth/Register.vue'),meta:{guest:true}},
  {path:'/',component:()=>import('@/layouts/UserLayout.vue'),meta:{requiresAuth:true},children:[
    {path:'',name:'Dashboard',component:()=>import('@/views/user/Dashboard.vue')},
    {path:'wallet',name:'Wallet',component:()=>import('@/views/user/Wallet.vue')},
    {path:'subscribe',name:'Subscribe',component:()=>import('@/views/user/Subscribe.vue')},
    {path:'keys',name:'ApiKeys',component:()=>import('@/views/user/ApiKeys.vue')},
    {path:'models',name:'Models',component:()=>import('@/views/user/Models.vue')},
    {path:'logs',name:'Logs',component:()=>import('@/views/user/Logs.vue')},
    {path:'change-password',name:'ChangePassword',component:()=>import('@/views/user/ChangePassword.vue')}
  ]},
  {path:'/admin',component:()=>import('@/layouts/AdminLayout.vue'),meta:{requiresAuth:true,requiresAdmin:true},children:[
    {path:'',name:'AdminDashboard',component:()=>import('@/views/admin/Dashboard.vue')},
    {path:'users',name:'AdminUsers',component:()=>import('@/views/admin/Users.vue')},
    {path:'orders',name:'AdminOrders',component:()=>import('@/views/admin/Orders.vue')},
    {path:'channels',name:'AdminChannels',component:()=>import('@/views/admin/Channels.vue')},
    {path:'models',name:'AdminModels',component:()=>import('@/views/admin/Models.vue')},
    {path:'pricing',name:'AdminPricing',component:()=>import('@/views/admin/Pricing.vue')},
    {path:'keys',name:'AdminKeys',component:()=>import('@/views/admin/Keys.vue')},
    {path:'logs',name:'AdminLogs',component:()=>import('@/views/admin/Logs.vue')},
    {path:'settings',name:'AdminSettings',component:()=>import('@/views/admin/Settings.vue')},
    {path:'change-password',name:'AdminChangePassword',component:()=>import('@/views/user/ChangePassword.vue')}
  ]},
  {path:'/:pathMatch(.*)*',redirect:'/'}
]
const router=createRouter({history:createWebHistory(),routes})
router.beforeEach((to,from,next)=>{
  const token=localStorage.getItem('token'),role=localStorage.getItem('userRole')
  const isAdmin=role&&role!=='user'
  if(to.meta.requiresAuth&&!token)return next('/login')
  if(to.meta.guest&&token)return next(isAdmin?'/admin':'/')
  if(to.meta.requiresAdmin&&!isAdmin)return next('/')
  if(isAdmin&&!to.meta.requiresAdmin&&!to.meta.guest)return next('/admin')
  next()
})
export default router
