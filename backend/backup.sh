#!/bin/bash
set -e

# ============================================
#  AI API 中转站 — 数据库备份脚本
#  建议加入 crontab: 0 3 * * * /opt/ai-api-proxy/backend/backup.sh
# ============================================

BACKUP_DIR="/opt/ai-api-proxy/backend/backups"
DATA_DIR="/opt/ai-api-proxy/backend/data"
DB_FILE="proxy.db"
RETENTION_DAYS=30    # 保留最近 30 天的备份
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_FILE}.${TIMESTAMP}.gz"

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 检查源文件
if [ ! -f "$DATA_DIR/$DB_FILE" ]; then
  echo "[ERROR] 数据库文件不存在: $DATA_DIR/$DB_FILE"
  exit 1
fi

# 执行备份（压缩）
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份: $DB_FILE → $BACKUP_FILE"
gzip -c "$DATA_DIR/$DB_FILE" > "$BACKUP_FILE"

# 验证备份
if [ $? -eq 0 ] && [ -f "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ 备份成功 — 文件: $BACKUP_FILE, 大小: $SIZE"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ 备份失败！"
  exit 1
fi

# 清理过期备份
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 清理 $RETENTION_DAYS 天前的旧备份..."
DELETED=$(find "$BACKUP_DIR" -name "${DB_FILE}.*.gz" -type f -mtime +$RETENTION_DAYS -delete -print)
if [ -n "$DELETED" ]; then
  echo "$DELETED" | while read f; do
    echo "  删除: $f"
  done
else
  echo "  没有需要清理的旧备份"
fi

# 显示当前备份统计
COUNT=$(find "$BACKUP_DIR" -name "${DB_FILE}.*.gz" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 当前备份总数: $COUNT, 总大小: $TOTAL_SIZE"
echo ""