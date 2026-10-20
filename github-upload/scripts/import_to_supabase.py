# ============================================================
# import_to_supabase.py —— 把 Excel 交期跟进表导入 Supabase
#
# 功能：
#   1. 读取 Excel（兼容旧格式 5 个 sheet 与未来统一表头格式）
#   2. 为出现的每个供应商自动创建 Auth 账号 + suppliers 行
#      （登录名 = 归一化后的供应商名称，初始密码见 .env ADMIN_PASSWORD）
#   3. upsert 订单：以 (项目sheet, 采购凭证, 物料, 供应商) 为唯一键
#      —— 供应商已填的「是否可以按时交付/供应商回复/备注」保留不覆盖
#   4. 记录每个 sheet 的列顺序（sheet_columns），前端按原表列展示
#
# 用法：
#   python import_to_supabase.py [Excel路径]
#   例：python import_to_supabase.py "F:\\中压物料交期跟进表-1015.xlsx"
#
# 前提：scripts/.env 中配置 SUPABASE_URL / SUPABASE_SERVICE_KEY
# ============================================================
import os
import re
import sys
import json
import hashlib
import datetime

import requests
from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_EXCEL = r"F:\中压物料交期跟进表-1015.xlsx"

# ---------- 读取 .env ----------
def load_env():
    env = {}
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8-sig"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
URL = ENV.get("SUPABASE_URL", "").rstrip("/")
KEY = ENV.get("SUPABASE_SERVICE_KEY", "")
ADMIN_PASSWORD = ENV.get("ADMIN_PASSWORD", "Admin@2026")
DEFAULT_PASSWORD = ENV.get("DEFAULT_PASSWORD", "Scm@2026")

if not URL or not KEY:
    sys.exit("错误：请先在 scripts/.env 中配置 SUPABASE_URL 与 SUPABASE_SERVICE_KEY（见 .env.example）")

S = requests.Session()
S.headers.update({
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
})

# ---------- 工具 ----------
def norm_supplier(name):
    """归一化供应商名：去掉 '21002382-北京ABB' 这类代码前缀与空白"""
    if name is None:
        return ""
    s = str(name).strip()
    s = re.sub(r"^\d+\s*-\s*", "", s)   # 去掉开头的数字代码-
    return s.strip()

def cell_str(v):
    """单元格转字符串：日期统一 yyyy-mm-dd"""
    if v is None:
        return ""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()

def num_or_none(v):
    s = cell_str(v)
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None

def make_row_key(sheet, supplier, row):
    """内容指纹：把该行所有业务字段拼起来取 md5。
    只要 项目/数量/需求日期/系统交期 等任意一项不同，指纹就不同。"""
    parts = [
        sheet, supplier,
        str(row.get("order_date") or ""),
        str(row.get("doc_no") or ""),
        str(row.get("supplier_order_no") or ""),
        str(row.get("project_name") or ""),
        str(row.get("material") or ""),
        str(row.get("short_text") or ""),
        str(row.get("qty_ordered")),
        str(row.get("qty_outstanding")),
        # 供应商回复/备注/交期状态不同，也视为不同记录（全部保留）
        str(row.get("delivery_status") or ""),
        str(row.get("supplier_reply") or ""),
        str(row.get("remarks") or ""),
    ]
    extra = row.get("extra") or {}
    for k in sorted(extra.keys()):
        parts.append(f"{k}={extra[k]}")
    return hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()


def inherit(target, old):
    """把库中旧行的「供应商已填内容」继承到新行（库内值优先）"""
    if old.get("delivery_status"):
        target["delivery_status"] = old["delivery_status"]
    if old.get("supplier_reply"):
        target["supplier_reply"] = old["supplier_reply"]
    if old.get("remarks"):
        target["remarks"] = old["remarks"]
    if old.get("supplier_reply_time"):
        target["supplier_reply_time"] = old["supplier_reply_time"]


# ---------- 列名映射（逐字匹配表头） ----------
CORE_MAP = {
    "日期": "order_date",
    "供应商名称": "supplier_name",
    "供应商": "supplier_name",
    "采购凭证": "doc_no",
    "采购订单号": "doc_no",
    "订单号": "doc_no",
    "供应订单号": "supplier_order_no",
    "项目名称": "project_name",
    "物料": "material",
    "物料描述": "short_text",
    "短文本": "short_text",
    "采购数量": "qty_ordered",
    "订单数量": "qty_ordered",
    "仍要交货": "qty_outstanding",
    "待交": "qty_outstanding",
    "是否可以按时交付": "delivery_status",
    "供应商回复": "supplier_reply",
    "备注": "remarks",
    # 供应商回复时间 由系统自动记录，导入时忽略该列内容
}

def map_row(headers, values):
    """一行 Excel -> 订单 dict（核心字段 + extra）"""
    row, extra = {}, {}
    for h, v in zip(headers, values):
        h = cell_str(h)
        if not h or h == "供应商回复时间":
            continue
        if h == "物料描述" or h == "短文本":
            row["short_text"] = cell_str(v)
        elif h in CORE_MAP:
            f = CORE_MAP[h]
            if f in ("qty_ordered", "qty_outstanding"):
                row[f] = num_or_none(v)
            else:
                row[f] = cell_str(v)
        else:
            extra[h] = cell_str(v)
    row["extra"] = extra
    return row

# ---------- Supabase REST ----------
def rest_get(table, params=None):
    r = S.get(f"{URL}/rest/v1/{table}", params=params or {})
    r.raise_for_status()
    return r.json()

def rest_upsert(table, rows, on_conflict):
    """分批 upsert"""
    out = 0
    for i in range(0, len(rows), 300):
        chunk = rows[i:i + 300]
        r = S.post(
            f"{URL}/rest/v1/{table}?on_conflict={on_conflict}",
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            data=json.dumps(chunk, ensure_ascii=False).encode("utf-8"),
        )
        if r.status_code not in (200, 201, 204):
            sys.exit(f"upsert {table} 失败: {r.status_code} {r.text[:500]}")
        out += len(chunk)
    return out

def admin_create_user(email, password):
    """创建 Auth 用户；已存在则返回已有 id（不重置密码）"""
    r = S.post(f"{URL}/auth/v1/admin/users",
               data=json.dumps({"email": email, "password": password,
                                "email_confirm": True}).encode("utf-8"))
    if r.status_code in (200, 201):
        return r.json()["id"], True
    if "already" in r.text.lower() or r.status_code == 422:
        # 查找已有用户
        page = 1
        while True:
            rr = S.get(f"{URL}/auth/v1/admin/users",
                       params={"page": page, "per_page": 200})
            users = rr.json().get("users", [])
            for u in users:
                if (u.get("email") or "").lower() == email.lower():
                    return u["id"], False
            if len(users) < 200:
                break
            page += 1
    sys.exit(f"创建用户 {email} 失败: {r.status_code} {r.text[:300]}")

# ---------- 主流程 ----------
def main():
    excel = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_EXCEL
    if not os.path.exists(excel):
        sys.exit(f"错误：找不到文件 {excel}")

    print(f"读取 {excel} ...")
    wb = load_workbook(excel, data_only=True, read_only=True)

    # 1) 扫描全部 sheet，收集订单与供应商
    all_orders, sheet_cols, supplier_names = [], {}, set()
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) < 2:
            continue
        headers = list(rows[0])
        sheet_cols[ws.title] = [cell_str(h) for h in headers if cell_str(h)]
        for values in rows[1:]:
            if all(v is None or str(v).strip() == "" for v in values):
                continue
            o = map_row(headers, values)
            sup = norm_supplier(o.get("supplier_name"))
            if not sup:
                continue
            o["source_sheet"] = ws.title
            o["supplier_name"] = sup
            supplier_names.add(sup)
            all_orders.append(o)
    print(f"共 {len(wb.sheetnames)} 个工作表，{len(all_orders)} 行订单，"
          f"{len(supplier_names)} 家供应商：{sorted(supplier_names)}")

    # 2) 建供应商账号（含管理员）
    #    注意：Supabase Auth 邮箱不支持中文，故用 s+哈希 的稳定邮箱；
    #    登录仍用「供应商名称」（前端通过 supplier_login_map 查映射）。
    def email_of(key):
        h = hashlib.md5(key.encode("utf-8")).hexdigest()[:12]
        return f"s{h}@portal.local"

    account_map = []
    created, existed = 0, 0
    for name in sorted(supplier_names):
        email = email_of(name)
        account_map.append((name, email))
        uid, is_new = admin_create_user(email, DEFAULT_PASSWORD)
        created += is_new
        existed += (not is_new)
        rest_upsert("suppliers", [{
            "supplier_key": name, "display_name": name,
            "login_email": email, "auth_user_id": uid, "role": "supplier",
        }], "supplier_key")
    print(f"供应商账号：新建 {created} 个，已存在 {existed} 个")

    # 管理员
    admin_email = ENV.get("ADMIN_EMAIL", "admin@portal.local")
    uid, is_new = admin_create_user(admin_email, ADMIN_PASSWORD)
    rest_upsert("suppliers", [{
        "supplier_key": "__ADMIN__", "display_name": "系统管理员",
        "login_email": admin_email, "auth_user_id": uid, "role": "admin",
    }], "supplier_key")
    print(f"管理员账号已就绪（{'新建' if is_new else '已存在'}）：{admin_email}")
    print("供应商账号对照表（重置密码时在 Supabase 控制台按邮箱查找）：")
    for name, email in account_map:
        print(f"  {name}  ->  {email}")

    # 3) 读取已有订单（保留供应商已填内容用）
    existing_rows = rest_get("orders", {
        "select": "id,row_key,source_sheet,doc_no,material,supplier_key,"
                  "delivery_status,supplier_reply,remarks,supplier_reply_time"})
    existing_by_key = {r["row_key"]: r for r in existing_rows}

    payload = []
    for o in all_orders:
        row = {
            "source_sheet": o["source_sheet"],
            "supplier_key": o["supplier_name"],
            "supplier_name": o.get("supplier_name"),
            "order_date": o.get("order_date") or None,
            "doc_no": o.get("doc_no") or None,
            "supplier_order_no": o.get("supplier_order_no") or None,
            "project_name": o.get("project_name") or None,
            "material": o.get("material") or None,
            "short_text": o.get("short_text") or None,
            "qty_ordered": o.get("qty_ordered"),
            "qty_outstanding": o.get("qty_outstanding"),
            "extra": o.get("extra") or {},
            # 先放 Excel 里的值，稍后若有库内已填内容则覆盖为库内值
            "delivery_status": o.get("delivery_status") or "",
            "supplier_reply": o.get("supplier_reply") or "",
            "remarks": o.get("remarks") or "",
        }
        row["row_key"] = make_row_key(o["source_sheet"], o["supplier_name"], row)
        payload.append(row)

    # 3.1) 完全相同的行（指纹一致）只保留一条
    dedup = {}
    for row in payload:
        dedup[row["row_key"]] = row
    if len(dedup) < len(payload):
        print(f"完全相同的重复行 {len(payload) - len(dedup)} 条已合并（其余因内容不同均保留为独立记录）。")
    payload = list(dedup.values())

    # 3.2) 保留供应商已填内容：先按指纹精确匹配；
    #      若指纹变了（如数量/需求日期被修改），在同订单组内继承旧行的填写内容
    incoming_keys = {r["row_key"] for r in payload}
    incoming_groups = {}
    for row in payload:
        g = (row["source_sheet"], row["doc_no"] or "", row["material"] or "", row["supplier_key"])
        incoming_groups.setdefault(g, []).append(row)

    superseded_ids = []
    for old in existing_rows:
        if old["row_key"] in incoming_keys:
            # 精确命中：直接继承库内已填内容
            tgt = dedup[old["row_key"]]
            inherit(tgt, old)
        else:
            g = (old["source_sheet"], old["doc_no"] or "", old["material"] or "", old["supplier_key"])
            if g in incoming_groups:
                # 该组内容已变化：把旧行填写内容继承给组内一条新行，旧行本身删除（避免累积）
                tgt = next((r for r in incoming_groups[g]
                            if not (r["delivery_status"] or r["supplier_reply"] or r["remarks"])),
                           incoming_groups[g][0])
                if old.get("delivery_status") or old.get("supplier_reply") or old.get("remarks"):
                    inherit(tgt, old)
                superseded_ids.append(old["id"])
    if superseded_ids:
        for i in range(0, len(superseded_ids), 200):
            chunk = superseded_ids[i:i + 200]
            r = S.delete(f"{URL}/rest/v1/orders",
                         params={"id": "in.(" + ",".join(str(x) for x in chunk) + ")"})
            if r.status_code not in (200, 204):
                sys.exit(f"删除过期行失败: {r.status_code} {r.text[:300]}")
        print(f"已清理内容变更前的旧记录 {len(superseded_ids)} 条（其填写内容已继承到新行）。")

    n = rest_upsert("orders", payload, "row_key")
    print(f"订单已写入/更新 {n} 条（内容相同的行覆盖更新，内容不同的行各自独立保留；供应商已填内容已保留）")

    # 4) 记录列顺序
    for sheet, cols in sheet_cols.items():
        rest_upsert("sheet_columns",
                    [{"source_sheet": sheet, "columns": cols,
                      "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}],
                    "source_sheet")
    print("各工作表列顺序已记录，前端将按原表列展示。")
    print("完成 ✔  网站刷新即可看到最新数据。")

if __name__ == "__main__":
    main()
