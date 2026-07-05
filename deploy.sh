#!/bin/bash
set -e

# ============================================
#  AI API 中转站 — 生产环境一键部署脚本
#  运行前请修改 nginx.conf 中的域名
# ============================================

echo "========================================"
echo "  AI API 中转站 部署脚本"
echo "========================================"

PROJECT_DIR="/opt/ai-api-proxy"
WEB_ROOT="/var/www/ai-api-proxy"

# 1. 拉取最新代码（如果使用 git）
if [ -d "$PROJECT_DIR/.git" ]; then
  echo "📦 拉取最新代码..."
  cd "$PROJECT_DIR"
  git pull
else
  echo "⚠️  未检测到 git 仓库，使用当前目录: $PROJECT_DIR"
fi

# 2. 安装后端依赖
echo "📦 安装后端依赖..."
cd "$PROJECT_DIR/backend"
npm install --production

# 3. 安装前端依赖 + 构建
echo "📦 安装前端依赖..."
cd "$PROJECT_DIR/frontend"
npm install
echo "🔨 构建前端..."
npm run build

# 4. 部署前端静态文件
echo "📂 部署前端文件到 $WEB_ROOT/dist ..."
sudo mkdir -p "$WEB_ROOT"
sudo rm -rf "$WEB_ROOT/dist"
sudo cp -r "$PROJECT_DIR/frontend/dist" "$WEB_ROOT/dist"

# 5. 重启后端（使用 PM2）
echo "🔄 重启后端服务..."
cd "$PROJECT_DIR/backend"
if pm2 list | grep -q "ai-api-proxy"; then
  pm2 restart ai-api-proxy
else
  pm2 start src/index.js --name ai-api-proxy --cwd "$PROJECT_DIR/backend"
fi
pm2 save

echo ""
echo "========================================"
echo "  ✅ 部署完成！"
echo "========================================"
echo "  后端: http://localhost:3000"
echo "  前端: http://localhost (通过 Nginx)"
echo ""
echo "  如果 Nginx 尚未配置："
echo "    sudo cp $PROJECT_DIR/nginx.conf /etc/nginx/sites-available/ai-api-proxy"
echo "    sudo ln -s /etc/nginx/sites-available/ai-api-proxy /etc/nginx/sites-enabled/"
echo "    sudo nginx -t && sudo systemctl reload nginx"
echo ""