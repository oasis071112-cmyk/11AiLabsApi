function parseStoredTime(value) {
  if (value instanceof Date) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  // SQLite CURRENT_TIMESTAMP 为 UTC 但不带时区，前端必须明确按 UTC 解析。
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text);
  const date = new Date(sqliteUtc ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBeijingTime(value, fallback = '—') {
  const date = parseStoredTime(value);
  if (!date) return value ? String(value) : fallback;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}:${lookup.second}`;
}
