// ============================================================
// supabase.js —— 初始化客户端 + 通用工具（toast / 转义 / 常量）
// ============================================================
"use strict";

window.sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// 「是否可以按时交付」三个预设选项及其样式类
window.DELIVERY_OPTIONS = ["按时交付", "延期", "待确认"];
window.STATUS_CLASS = { "按时交付": "status-ontime", "延期": "status-delay", "待确认": "status-pending" };

// HTML 转义
window.esc = function (s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

// 右下/底部提示
let _toastTimer = null;
window.toast = function (text, type) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.className = "toast " + (type || "");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
};

// 时间格式化（本地时区）
window.fmtTime = function (ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 错误提示统一处理
window.handleErr = function (e, fallback) {
  console.error(e);
  toast((e && e.message) || fallback || "操作失败", "err");
};
