// ============================================================
// 站点配置模板
// 用法：把本文件复制为 js/config.js，并填入你的 Supabase 项目信息。
//       js/config.js 已被 .gitignore 忽略，不会上传到 GitHub（避免误提交）。
// 获取位置：Supabase 控制台 -> Project Settings -> API Keys
//   - SUPABASE_ANON_KEY 填 Publishable key（sb_publishable_... 开头，
//     旧项目则是 anon public 那条 eyJ...）
//   - Project URL 在顶部「Connect」按钮或 Settings -> Data API 中
// ============================================================
window.SUPABASE_URL = 'https://dvajiepjazvljtjkdsxk.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_8vKNw2fP0wS1euY86Y86Eg_GeO1dxxN';

// 本站点公网地址（用于“忘记密码”邮件的重定向回跳）
// 格式一般为：https://<你的GitHub用户名>.github.io/<仓库名>/
window.SITE_URL = 'https://YOUR-GITHUB-USER.github.io/YOUR-REPO';
