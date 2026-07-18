import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../src/views/auth/Login.vue', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api/index.js', import.meta.url), 'utf8');

assert.match(login, /native-type="button"[^>]*@click="handleLogin"/, '登录按钮必须由 Vue 点击事件触发，不能依赖原生表单提交');
assert.match(login, /v-if="loginError"/, '登录失败必须在表单内保留可见提示');
assert.match(login, /loginError\.value\s*=\s*e\.response/, '登录请求失败必须写入表单错误状态');
assert.match(api, /ElMessage\.error\(errorMessage\)/, '全局请求层必须提示登录错误');
assert.doesNotMatch(api, /if\(!isLoginRequest\)ElMessage\.error/, '登录错误不能被全局请求层静默跳过');

console.log('登录错误提示防回归检查通过');
