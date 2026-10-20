"""
数据库层：SQLite 连接、建表、供应商名称归一化。
数据库文件位于项目 data/delivery.db，随项目可移植。
"""
import os
import re
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "delivery.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS suppliers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_key  TEXT UNIQUE NOT NULL,   -- 归一化后的匹配键（登录后据此筛选订单）
    display_name  TEXT NOT NULL,          -- 该供应商在表格中出现过的原始名称代表
    username      TEXT UNIQUE NOT NULL,   -- 登录用户名
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'supplier',  -- 'supplier' 或 'admin'
    created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    row_key         TEXT UNIQUE NOT NULL,  -- 行唯一指纹，用于重新导入时去重
    source_sheet    TEXT,                  -- 来源工作表
    supplier_key    TEXT,                  -- 归一化供应商键（筛选依据）
    supplier_name   TEXT,                  -- 原始供应商名称
    doc_no          TEXT,                  -- 采购凭证 / 订单号
    project_name    TEXT,                  -- 项目名称
    material        TEXT,                  -- 物料
    short_text      TEXT,                  -- 短文本
    qty_ordered     REAL,                  -- 采购数量 / 订单数量
    qty_outstanding REAL,                  -- 仍要交货 / 待交
    qty_delivered   REAL,                  -- 已交（北美表）
    supplier_reply  TEXT,                  -- 供应商回复（供应商可在线编辑）
    remarks         TEXT,                  -- 备注（供应商可在线编辑）
    raw_json        TEXT,                  -- 原始整行数据（完整保留，便于扩展/导出）
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_key);
CREATE INDEX IF NOT EXISTS idx_orders_sheet ON orders(source_sheet);
"""


def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def normalize_supplier(name):
    """将 '21002382-北京ABB' 这类带供应商代码前缀的名称归一化为 '北京ABB'。
    不带前缀的名称原样返回。这样同一家供应商在不同工作表中的不同写法可统一匹配。"""
    if name is None:
        return ""
    name = str(name).strip()
    m = re.match(r"^(\d+)[-\s]+(.+)$", name)
    if m:
        return m.group(2).strip()
    return name


if __name__ == "__main__":
    init_db()
    print("数据库已初始化：", DB_PATH)
