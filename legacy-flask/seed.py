"""
导入脚本：读取 Excel 交付表 -> 写入 SQLite。
- 多工作表合并为统一的 orders 表（用 source_sheet 标记来源）。
- 按表头“名称”映射字段（不依赖列位置），兼容各表列顺序差异。
- 供应商名称归一化后建立账号；重新运行可增量更新，保留供应商已填写的回复/备注。
"""
import os
import re
import json
import openpyxl
from werkzeug.security import generate_password_hash

from db import get_db, init_db, normalize_supplier, DB_PATH

EXCEL_PATH = os.environ.get("EXCEL_PATH", r"F:\中压物料交期跟进表-1015.xlsx")
DEFAULT_PASSWORD = os.environ.get("DEFAULT_PASSWORD", "Scm@2026")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@2026")

# 标准字段 -> 可能的表头名称（按名称匹配，忽略空白）
FIELD_MAP = {
    "doc_no":          ["采购凭证", "订单号"],
    "project_name":    ["项目名称"],
    "material":        ["物料"],
    "short_text":      ["短文本"],
    "qty_ordered":     ["采购数量", "订单数量"],
    "qty_outstanding": ["仍要交货", "待交"],
    "qty_delivered":   ["已交"],
    "supplier_reply":  ["供应商回复"],
    "remarks":         ["备注"],
}


def norm_header(h):
    return re.sub(r"\s+", "", str(h)) if h is not None else ""


def build_lookup(header):
    d = {}
    for i, h in enumerate(header, start=1):
        if h is None:
            continue
        d[norm_header(h)] = i
    return d


def extract_row(lookup, row):
    out = {}
    for canonical, names in FIELD_MAP.items():
        val = None
        for n in names:
            idx = lookup.get(norm_header(n))
            if idx and idx <= len(row):
                v = row[idx - 1]
                if v is not None and str(v).strip() != "":
                    val = v
                    break
        out[canonical] = val
    return out


def to_number(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def main():
    if not os.path.exists(EXCEL_PATH):
        raise SystemExit(f"找不到 Excel 文件：{EXCEL_PATH}\n请确认路径，或用环境变量 EXCEL_PATH 指定。")

    init_db()
    conn = get_db()

    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    inserted = updated = 0
    supplier_display = {}   # key -> representative raw name
    seen_keys = set()

    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        try:
            header = list(next(rows))
        except StopIteration:
            continue
        lookup = build_lookup(header)
        if norm_header("供应商名称") not in lookup:
            print(f"[跳过] 工作表《{ws.title}》未找到“供应商名称”列")
            continue

        for row in rows:
            if all(c is None for c in row):
                continue
            f = extract_row(lookup, row)
            raw_name = row[lookup[norm_header("供应商名称")] - 1]
            if raw_name is None or str(raw_name).strip() == "":
                continue
            key = normalize_supplier(raw_name)
            seen_keys.add(key)
            supplier_display.setdefault(key, str(raw_name).strip())

            row_key = "||".join([
                str(ws.title),
                str(f["doc_no"] or ""),
                str(f["material"] or ""),
                str(f["project_name"] or ""),
                str(f["short_text"] or ""),
            ])

            cur = conn.execute(
                "SELECT id FROM orders WHERE row_key = ?", (row_key,)
            ).fetchone()

            cols = (
                row_key, ws.title, key, str(raw_name).strip(),
                str(f["doc_no"] or ""), str(f["project_name"] or ""),
                str(f["material"] or ""), str(f["short_text"] or ""),
                to_number(f["qty_ordered"]), to_number(f["qty_outstanding"]),
                to_number(f["qty_delivered"]), json.dumps(row, ensure_ascii=False, default=str),
            )
            if cur is None:
                conn.execute(
                    """INSERT INTO orders
                       (row_key, source_sheet, supplier_key, supplier_name,
                        doc_no, project_name, material, short_text,
                        qty_ordered, qty_outstanding, qty_delivered, raw_json)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    cols,
                )
                inserted += 1
            else:
                conn.execute(
                    """UPDATE orders SET
                          source_sheet=?, supplier_key=?, supplier_name=?,
                          doc_no=?, project_name=?, material=?, short_text=?,
                          qty_ordered=?, qty_outstanding=?, qty_delivered=?, raw_json=?
                        WHERE row_key=?""",
                    cols[1:] + (row_key,),
                )
                updated += 1

    # 创建供应商账号（已存在则跳过，保留其密码与已填内容）
    created_suppliers = 0
    for key in seen_keys:
        exist = conn.execute(
            "SELECT id FROM suppliers WHERE supplier_key = ?", (key,)
        ).fetchone()
        if exist is None:
            conn.execute(
                "INSERT INTO suppliers (supplier_key, display_name, username, password_hash, role) VALUES (?,?,?,?,?)",
                (key, supplier_display[key], key, generate_password_hash(DEFAULT_PASSWORD), "supplier"),
            )
            created_suppliers += 1

    # 管理员账号
    admin_exist = conn.execute(
        "SELECT id FROM suppliers WHERE username = 'admin'"
    ).fetchone()
    if admin_exist is None:
        conn.execute(
            "INSERT INTO suppliers (supplier_key, display_name, username, password_hash, role) VALUES (?,?,?,?,?)",
            ("__admin__", "系统管理员", "admin", generate_password_hash(ADMIN_PASSWORD), "admin"),
        )

    conn.commit()
    conn.close()

    print("=" * 60)
    print(f"Excel 来源     : {EXCEL_PATH}")
    print(f"数据库文件     : {DB_PATH}")
    print(f"新增订单行     : {inserted}")
    print(f"更新订单行     : {updated}  （基础字段刷新，供应商回复/备注保留）")
    print(f"供应商账号总数 : {len(seen_keys)}（本次新建 {created_suppliers} 个）")
    print("-" * 60)
    print("登录凭据（请尽快修改默认密码）：")
    print(f"  管理员  : 用户名 admin / 密码 {ADMIN_PASSWORD}")
    print(f"  供应商  : 用户名 = 供应商名称（如 明阳、北京ABB）/ 密码 {DEFAULT_PASSWORD}")
    print("=" * 60)


if __name__ == "__main__":
    main()
