<template>
<div class="admin-page settings-page"><h3 style="margin-bottom:16px">系统设置</h3>
<el-tabs v-model="tab">
  <el-tab-pane label="基础设置" name="base"><el-card><el-form label-width="200px">
    <el-form-item v-for="c in baseConfigs" :key="c.config_key" :label="c.description || c.config_key"><el-input v-if="!['registration_enabled','new_user_gift_enabled'].includes(c.config_key)" v-model="c.config_value"/><el-switch v-else v-model="c.config_value" active-value="true" inactive-value="false"/></el-form-item>
    <el-form-item><el-button type="primary" :loading="saving" @click="saveConfigs(baseConfigs)">保存基础设置</el-button></el-form-item>
  </el-form></el-card></el-tab-pane>
  <el-tab-pane label="支付设置" name="payment"><el-card><el-alert title="支付密钥仅在保存时发送给后端并加密保存，页面不会回显完整 PKey。回调地址由“公开 HTTPS 地址”自动生成。" type="info" show-icon :closable="false" style="margin-bottom:18px"/>
    <el-form label-width="200px"><el-form-item v-for="c in paymentConfigs" :key="c.config_key" :label="c.description || c.config_key"><el-switch v-if="c.config_key==='payment_enabled'" v-model="c.config_value" active-value="true" inactive-value="false"/><el-input v-else v-model="c.config_value"/></el-form-item><el-form-item><el-button type="primary" :loading="saving" @click="saveConfigs(paymentConfigs)">保存支付基础设置</el-button></el-form-item></el-form>
    <div class="flex-between" style="margin:22px 0 12px"><strong>易支付服务商</strong><el-button type="primary" @click="openProvider()">新增易支付</el-button></div>
    <el-table :data="providers" size="small"><el-table-column prop="provider_name" label="名称"/><el-table-column prop="api_base_url" label="API 地址" min-width="220" show-overflow-tooltip/><el-table-column prop="merchant_id" label="PID" width="140"/><el-table-column label="支付方式" width="150"><template #default="{row}">{{ paymentMethodLabels(row.enabled_methods) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'">{{ row.status==='active'?'启用':'停用' }}</el-tag></template></el-table-column><el-table-column label="操作" width="170"><template #default="{row}"><el-button link type="primary" @click="openProvider(row)">编辑</el-button><el-button link type="danger" @click="removeProvider(row)">删除</el-button></template></el-table-column></el-table>
  </el-card></el-tab-pane>
</el-tabs>
<el-dialog v-model="providerDialog" :title="providerForm.id?'编辑易支付':'新增易支付'" width="560px"><el-form :model="providerForm" label-width="128px"><el-form-item label="服务商名称"><el-input v-model="providerForm.provider_name"/></el-form-item><el-form-item label="API 地址"><el-input v-model="providerForm.api_base_url" placeholder="https://pay.example.com"/></el-form-item><el-form-item label="商户 PID"><el-input v-model="providerForm.merchant_id"/></el-form-item><el-form-item label="商户 PKey"><el-input v-model="providerForm.merchant_key" type="password" show-password :placeholder="providerForm.id?'留空则保留原 PKey':'易支付商户密钥'"/></el-form-item><el-form-item label="启用支付方式"><el-checkbox-group v-model="providerForm.enabled_methods"><el-checkbox label="alipay">支付宝</el-checkbox><el-checkbox label="wechat">微信支付</el-checkbox></el-checkbox-group></el-form-item><el-form-item v-if="providerForm.enabled_methods.includes('alipay')" label="支付宝通道 ID"><el-input v-model="providerForm.alipay_type" placeholder="留空使用 alipay"/></el-form-item><el-form-item v-if="providerForm.enabled_methods.includes('wechat')" label="微信通道 ID"><el-input v-model="providerForm.wechat_type" placeholder="留空使用 wxpay"/></el-form-item><el-form-item label="状态"><el-switch v-model="providerForm.status" active-value="active" inactive-value="inactive" active-text="启用" inactive-text="停用"/></el-form-item></el-form><template #footer><el-button @click="providerDialog=false">取消</el-button><el-button type="primary" :loading="providerSaving" @click="saveProvider">保存</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue';import api from '@/api';import { ElMessage, ElMessageBox } from 'element-plus'
const configs=ref([]),providers=ref([]),saving=ref(false),providerSaving=ref(false),providerDialog=ref(false),tab=ref('base')
const baseConfigs=computed(()=>configs.value.filter(item=>!item.config_key.startsWith('payment_'))),paymentConfigs=computed(()=>configs.value.filter(item=>item.config_key.startsWith('payment_')))
const freshProvider=()=>({id:null,provider_name:'易支付',api_base_url:'',merchant_id:'',merchant_key:'',alipay_type:'',wechat_type:'',enabled_methods:['alipay'],status:'inactive'})
const providerForm=reactive(freshProvider())
async function load(){try{const [configResponse,providerResponse]=await Promise.all([api.get('/api/admin/config'),api.get('/api/admin/payment/providers')]);configs.value=configResponse.data.data;providers.value=providerResponse.data.data}catch(e){}}
onMounted(load)
async function saveConfigs(items){saving.value=true;try{for(const item of items){await api.put(`/api/admin/config/${item.config_key}`,{config_value:item.config_value})}ElMessage.success('设置已保存')}catch(e){}saving.value=false}
function paymentMethodLabels(methods){const labels={alipay:'支付宝',wechat:'微信支付'};return (Array.isArray(methods)?methods:[]).map(method=>labels[method]||method).join('、')||'未配置'}
function openProvider(row){Object.assign(providerForm,freshProvider(),row?{...row,enabled_methods:Array.isArray(row.enabled_methods)?row.enabled_methods:['alipay'],merchant_key:''}:{});providerDialog.value=true}
async function saveProvider(){providerSaving.value=true;try{if(providerForm.id)await api.put(`/api/admin/payment/providers/${providerForm.id}`,providerForm);else await api.post('/api/admin/payment/providers',providerForm);ElMessage.success('易支付服务商已保存');providerDialog.value=false;await load()}catch(e){}providerSaving.value=false}
async function removeProvider(row){try{await ElMessageBox.confirm(`确定删除“${row.provider_name}”吗？`,'删除易支付服务商',{type:'warning'});await api.delete(`/api/admin/payment/providers/${row.id}`);ElMessage.success('已删除');await load()}catch(e){}}
</script>
