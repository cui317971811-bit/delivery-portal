# 中压物料交期跟进 · 供应商交付门户

让供应商用「账号（供应商名称）+ 密码」登录后，只能看到并**在线编辑自己名下**的订单（按“供应商名称”列匹配），
管理员可在后台查看全部、重新导入 Excel、管理账号。

技术栈：**Python + Flask + SQLite**（数据库就是一个文件，零额外安装，便于备份与迁移）。

---

## 一、目录结构

```
supplier-portal/
├── app.py            # Web 服务（登录、筛选、编辑接口）
├── db.py             # 数据库初始化、连接、供应商名称归一化
├── seed.py           # 读取 Excel -> 写入数据库
├── requirements.txt  # 依赖清单
├── templates/        # 登录页 / 供应商页 / 管理后台 页面
├── data/
│   └── delivery.db   # SQLite 数据库文件（首次运行自动生成）
└── README.md         # 本文件
```

---

## 二、环境准备（一次性）

用**本项目配套的 Python** 建一个隔离环境并装依赖（避免污染你的系统）：

```bat
:: 1) 创建虚拟环境（路径含中文也无需担心，下面用绝对路径示例）
"C:\Users\暗动\.workbuddy\binaries\python\envs\default\Scripts\python.exe" -m venv venv

:: 2) 安装依赖
venv\Scripts\python.exe -m pip install -r requirements.txt
```

> 如果你已按本说明装好依赖，之后只需用 `venv\Scripts\python.exe` 运行脚本即可。

---

## 三、数据库怎么用（重点）

本项目使用 **SQLite**——一个把整个数据库存成单个文件的轻量数据库，不需要装 MySQL/SQL Server 那样的服务端，
自带在 Python 里。文件就是 `data/delivery.db`。

### 1) 打开 / 查看数据库

最简单：用免费的 **DB Browser for SQLite**（https://sqlitebrowser.org）图形化打开 `data/delivery.db`，
可直接浏览、双击改值、执行 SQL。

命令行方式（用本项目 Python 自带 `sqlite3` 模块）：

```bat
venv\Scripts\python.exe -c "import sqlite3,os; print(os.path.abspath('data/delivery.db'))"
```

进入交互式查询（把下面的路径换成实际路径）：

```bat
venv\Scripts\python.exe -m sqlite3 data/delivery.db
```

进入后常用命令：
- `.tables`            列出所有表
- `.schema orders`     查看表结构
- `.headers on`        查询结果显示列名
- `.mode column`       列对齐显示
- `.quit`              退出

### 2) 两张核心表

| 表名 | 作用 |
|---|---|
| `suppliers` | 账号表：供应商名称、登录名、密码（哈希）、角色 |
| `orders`   | 订单表：每条交付记录（来源工作表、供应商、单号、项目、物料、数量、供应商回复、备注…） |

### 3) 常用查询 SQL 示例

```sql
-- 看某家供应商的订单（把“明阳”换成实际名称）
SELECT doc_no, project_name, material, qty_ordered, qty_outstanding, supplier_reply
FROM orders WHERE supplier_key = '明阳';

-- 统计每家供应商的未交数量合计
SELECT supplier_name, SUM(qty_outstanding) AS 未交合计
FROM orders GROUP BY supplier_name ORDER BY 未交合计 DESC;

-- 看所有账号
SELECT username, display_name, role FROM suppliers;

-- 看最近被供应商修改过的记录
SELECT supplier_name, doc_no, supplier_reply, updated_at
FROM orders WHERE supplier_reply <> '' ORDER BY updated_at DESC;
```

### 4) 备份与恢复（强烈建议定期做）

SQLite 在做写操作时是单文件的，**直接复制文件即可备份**：

```bat
copy data\delivery.db data\delivery_backup_20261019.db
```

恢复：把备份文件复制回 `data\delivery.db` 即可。

### 5) 新增 / 修改供应商账号

**方式 A（推荐）：用管理后台**
登录管理员账号（默认 `admin` / `Admin@2026`）→ “供应商账号管理” → 填写名称与初始密码 → 添加。
也可在后台直接给某账号“重置密码”。

**方式 B：直接写 SQL**

```sql
-- 新增供应商（登录名与供应商名称一致；密码请用下面的方式生成哈希）
INSERT INTO suppliers (supplier_key, display_name, username, password_hash, role)
VALUES ('新供应商名', '新供应商名', '新供应商名',
        '<哈希值>', 'supplier');
```

密码哈希不能用明文，用本项目脚本生成（把 `你的密码` 换成实际密码）：

```bat
venv\Scripts\python.exe -c "from werkzeug.security import generate_password_hash as g; print(g('你的密码'))"
```

把输出的长串贴到上面的 `<哈希值>` 处。

### 6) 重新导入 Excel（刷新基础数据）

管理员后台点「重新从 Excel 导入数据」即可；或用命令：

```bat
venv\Scripts\python.exe seed.py
```

导入是**增量更新**：已有订单按“行指纹”匹配并刷新基础字段（数量、项目等），
但**供应商已填写的「供应商回复」「备注」会保留**，不会丢失。

---

## 四、启动与访问

```bat
venv\Scripts\python.exe app.py
```

`app.py` 已默认监听 `host="0.0.0.0"`（即对所有网卡/局域网开放），本机浏览器打开 `http://127.0.0.1:5000` 即可：
- 供应商：用「供应商名称」作账号 + 初始密码登录，进入“我的订单”，直接改「供应商回复 / 备注」，失焦自动保存。
- 管理员：`admin` / `Admin@2026`，进入后台管理。

### 让内网同事访问（两步）

1. **放行防火墙端口**：在本机**右键 `open_port_5000.bat` → “以管理员身份运行”**，会自动添加一条
   “允许 TCP 5000 入站”的防火墙规则。
   （不再需要开放时，右键运行 `close_port_5000.bat` 即可删除该规则。）
2. **把访问地址告诉同事**：在本机命令行输入 `ipconfig`，找到“IPv4 地址”（一般是 `192.168.x.x` 或 `10.x.x.x`），
   让同事在浏览器输入 `http://该IP:5000`。例如本机 IP 是 `192.168.1.23`，同事就访问 `http://192.168.1.23:5000`。

> 说明：若你只想本机自己访问、不允许同事连进来，运行前设环境变量 `HOST=127.0.0.1` 即可临时收回；
> 或把 `app.py` 的 `HOST = os.environ.get("HOST", "0.0.0.0")` 默认值改回 `"127.0.0.1"`。

---

## 五、上线前必做的安全项

1. **改密钥**：设置环境变量 `SECRET_KEY` 为一个随机长字符串（否则会话可被伪造）。
2. **改默认密码**：立即修改 `admin` 与各家供应商的初始密码。
3. **HTTPS**：公网部署务必加反向代理（Nginx/Caddy）+ HTTPS，不要明文传输密码。
4. **备份**：每日复制 `data/delivery.db` 到安全位置。
5. 当前为单文件 SQLite，适合中小团队；若并发量很大，可迁移到 MySQL/PostgreSQL（改 `db.py` 连接即可）。

---

## 六、常见问题

- **登录提示“用户名或密码错误”**：确认用的是「供应商名称」（如 `明阳`、`北京ABB`），且密码为导入时设定的初始密码；可在后台重置。
- **某供应商看不到“西门子+欧玛”表里带代码前缀的记录**：系统已自动把 `21002382-北京ABB` 这类名称归一化为 `北京ABB` 以合并同一家，无需手动处理。
- **想加新列/新表**：在 `db.py` 的 `SCHEMA` 里加字段，并在 `seed.py` 的 `FIELD_MAP` 增加表头映射即可。
