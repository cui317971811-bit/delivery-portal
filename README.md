# 中压物料交期跟进 · 供应商交付门户

供应商用**账号密码登录**，只能看到并编辑**自己名下**的订单；管理员可查看全部、发布公告、导出数据。
架构：**GitHub Pages（前端静态页面）+ Supabase（云端数据库 + 登录认证 + 行级权限）**——代码在 GitHub，公网可访问，无需自己维护服务器。

> ⚠️ 本仓库不含任何密钥。`js/config.js` 与 `scripts/.env` 均在 `.gitignore` 中，不会被上传到 GitHub。

---

## 一、目录结构

```
supplier-portal/
├── index.html                 # 单页应用（登录 / 我的订单 / 管理后台）
├── assets/logo.webp           # 阳光电源 Logo
├── css/style.css              # 样式（简洁浅色，电脑手机自适应）
├── js/
│   ├── config.example.js      # 配置模板 → 复制为 config.js 并填写
│   ├── supabase.js            # SDK 初始化 + 工具函数
│   ├── auth.js                # 登录 / 退出 / 修改密码
│   ├── orders.js              # 我的订单（分项目标签页、行内编辑、批量填写）
│   ├── admin.js               # 管理后台（全部订单、账号、审计、公告、导出）
│   └── app.js                 # 应用入口与事件绑定
├── supabase/schema.sql        # 建表 SQL（含行级权限 RLS，只需执行一次）
├── scripts/
│   ├── import_to_supabase.py  # Excel → Supabase 导入脚本
│   ├── requirements.txt       # 脚本依赖
│   └── .env.example           # 密钥配置模板 → 复制为 .env 并填写
├── run_import.bat             # Windows 一键导入（拖入 Excel 回车即可）
├── legacy-flask/              # 旧版 Flask+SQLite（仅留档，可回退）
└── .gitignore
```

## 二、上线全流程（约 20 分钟）

### 第 1 步：创建 Supabase 项目
1. 打开 https://supabase.com → Sign up 注册（免费）。
2. New project：起名（如 `delivery-portal`），设置数据库密码（记下来），区域选 **Singapore / Tokyo**（国内访问较快）。
3. 等待项目初始化完成。

### 第 2 步：建表（可重复执行，自动清理旧对象）
1. Supabase 左侧 → **SQL Editor** → New query。
2. 打开本仓库 `supabase/schema.sql`，**全选复制**粘贴进去 → **Run**。
3. 提示 Success 即建表完成（含供应商表、订单表、审计日志、公告表、行级权限）。

### 第 3 步：获取密钥并配置
1. Supabase 左侧 → **Project Settings → API Keys**：
   - `Project URL` → 备用（在顶部「Connect」按钮或 Settings → Data API 中；也可由浏览器地址栏 `/project/<ref>` 推出：`https://<ref>.supabase.co`）
   - **Publishable key**（`sb_publishable_...` 开头；旧版叫 `anon public`）→ 备用（前端用，设计上可公开）
   - **Secret keys**（`sb_secret_...` 开头；旧版叫 `service_role`）→ 备用（**保密**，仅导入脚本用）
2. 前端配置：复制 `js/config.example.js` 为 `js/config.js`，填入：
   ```js
   window.SUPABASE_URL = 'https://xxxx.supabase.co';
   window.SUPABASE_ANON_KEY = 'eyJ...anon...';
   window.SITE_URL = 'https://<你的GitHub用户名>.github.io/<仓库名>';
   ```
3. 导入脚本配置：复制 `scripts/.env.example` 为 `scripts/.env`，填入 URL 与 service_role key。

### 第 4 步：导入 Excel 数据（本机运行一次）
**省事做法（推荐，无需装 Python）：** 直接**双击**项目根目录的 `run_import.bat`，把交期跟进表 Excel 拖进黑色窗口、按回车即可。脚本已绑定本机自带的 Python。
**手动做法：** 安装 Python（https://www.python.org/downloads/ ，安装时勾选 *Add to PATH*），然后命令行进入 `scripts/` 目录执行：
```bat
pip install -r requirements.txt
python import_to_supabase.py "F:\中压物料交期跟进表-1015.xlsx"
```
脚本会自动：为出现的每家供应商创建账号（登录名=供应商名称，初始密码 `Scm@2026`）+ 管理员账号；导入全部订单；**供应商已填的回复/备注/状态会保留**；记录每个 sheet 的列顺序。控制台会打印「供应商→邮箱」对照表，记下管理员登录名 `admin`、密码 `Admin@2026`。

**重复行的处理规则（重要）**：脚本按「内容指纹」判断同一条记录——指纹由该行的**全部字段**（项目、订单号、物料、数量、SG需求、系统交期、供应商回复、备注…）整体算出：
- 指纹相同 → 视为同一条，覆盖更新（如本次合并了 11 条完全相同的行）；
- **任意一处内容不同 → 各自独立成行，全部保留**（例如同一订单号+物料分属不同项目、数量不同时，两条都会保留）；
- 若某行内容被修改（如数量变更），旧行会被新行替换，且**供应商在网站上填的内容会继承到新行**。

### 第 5 步：发布到 GitHub Pages
1. 在 GitHub 新建仓库（如 `delivery-portal`，Public）。
2. 把本项目全部文件上传（GitHub 网页上传或 git 均可；**确认 config.js 与 .env 没有被提交**）。
3. 仓库 → Settings → Pages → Source 选 `Deploy from a branch` → 分支 `main`、目录 `/ (root)` → Save。
4. 一两分钟后访问 `https://<你的GitHub用户名>.github.io/<仓库名>/`，这就是发给供应商的公网地址（HTTPS 加密）。

## 三、日常使用

| 事项 | 方法 |
|---|---|
| 供应商登录 | 账号 = 供应商名称（与表内一致），初始密码 `Scm@2026`，登录后右上角可改密码 |
| 填写反馈 | 「我的订单」按项目分标签页；表格列与原 Excel 一致；直接修改**是否可以按时交付 / 供应商回复 / 备注**，光标移开自动保存，回复时间自动记录 |
| 批量填写 | 勾选多行 → 「批量填写」→ 选状态/填内容 → 应用到勾选行 |
| 状态颜色 | 按时交付 = 蓝、延期 = 红、待确认 = 黄（下拉与表格同步变色） |
| 修改记录 | 供应商点「查看修改记录」看自己的；管理员在后台看全部（谁、何时、改了什么） |
| 管理员查看全部 | `admin` 登录 → 管理后台（全部订单 / 供应商账号 / 修改记录 / 公告 / 导入说明） |
| 发布公告 | 后台「公告管理」→ 发布；供应商登录后顶部显示公告条，可看历史公告 |
| 导出数据 | 后台「导出 CSV」或「导出 Excel(.xlsx)」 |
| 每周更新数据 | 双击 `run_import.bat`，拖入新 Excel 回车（自动增量更新，保留供应商已填内容） |
| 新增供应商 | 新 Excel 里出现的新供应商在导入时自动建号 |
| 重置某供应商密码 | 运行导入脚本时会打印「供应商 → 邮箱」对照表；在 Supabase 控制台 → Authentication → Users → 按对应邮箱找到账号 → 直接改密码 |

## 四、安全说明

- **行级权限（RLS）**：数据库层面强制供应商只能读/写自己的行；即使绕过前端，也只能改「是否可以按时交付 / 供应商回复 / 备注」三个字段（触发器守卫）。
- 匿名访客无法读取任何订单数据。
- `anon key` 是设计上可公开的；`service_role key` 绝不能出现在前端或 GitHub。
- 按你的要求：未开启登录失败锁定与会话超时；回复/备注无字数限制。
- GitHub Pages 自带 HTTPS，公网传输已加密。

## 五、常见问题

- **页面提示“尚未配置 js/config.js”**：没做第 3 步，复制模板填好后重新上传。
- **登录报“找不到该供应商名称”**：账号必须与 Excel 中「供应商名称」完全一致（导入时自动去掉 `21002382-` 这类代码前缀）。
- **改完没保存成功**：检查网络；刷新看数据是否回显；可在「修改记录」中核实。
- **导入脚本报错连不上**：确认本机能访问 supabase.com（必要时关闭代理再跑）；检查 `.env` 是否填对。

---

*旧版（Flask + SQLite，本机局域网版）完整保留在 `legacy-flask/`，使用方法见其中的 README。*
