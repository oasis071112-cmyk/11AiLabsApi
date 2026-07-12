#!/usr/bin/env bash
# 核心链路冒烟测试
# 用法：先启动后端 npm run dev，再运行 bash test.sh

set -e
BASE="http://localhost:3000"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅ $desc"
    PASS=$((PASS+1))
  else
    echo "  ❌ $desc — 预期包含 '$expected'，实际: $(echo $actual | head -c 100)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== 认证模块 ==="

# 1. 正确登录
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
check "admin登录成功" '"token"' "$R"

# 2. 错误密码
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong"}')
check "错误密码返回401" '"error"' "$R"

# 3. 获取当前用户
TOKEN=$(echo "$R" 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
fi
R=$(curl -s $BASE/api/auth/me -H "Authorization: Bearer $TOKEN")
check "/me返回用户信息" '"username"' "$R"

echo ""
echo "=== 代理模块 ==="

# 4. 获取模型列表（需要有效的 API Key）
# 先获取 testuser 的 Key
TUSER_TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"testuser","password":"user123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
KEYS=$(curl -s $BASE/api/user/keys -H "Authorization: Bearer $TUSER_TOKEN")
API_KEY=$(echo "$KEYS" | grep -o '"key_prefix":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$API_KEY" ]; then
  R=$(curl -s $BASE/v1/models -H "Authorization: Bearer $API_KEY")
  check "模型列表返回" '"object":"list"' "$R"
else
  echo "  ⚠️  跳过 — testuser 没有 API Key"
fi

echo ""
echo "=== 结果: $PASS 通过, $FAIL 失败 ==="
[ "$FAIL" -eq 0 ] && echo "✅ 全部通过" || echo "❌ 有测试失败"
