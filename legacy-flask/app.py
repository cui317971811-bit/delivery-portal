"""
供应商交付门户 —— Flask 后端
功能：
  - 供应商用“账号（供应商名称）+ 密码”登录
  - 登录后仅能看到并编辑自己名下的订单（按 supplier_key 匹配）
  - 可在线修改“供应商回复”和“备注”，保存即写入数据库
  - 管理员可查看全部、重新导入 Excel、管理供应商账号与密码
"""
import os
from flask import (
    Flask, request, session, redirect, url_for, render_template,
    jsonify, flash,
)
from werkzeug.security import generate_password_hash, check_password_hash

from db import get_db, init_db

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-in-production")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

PORT = int(os.environ.get("PORT", "5000"))


def fmt_num(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


app.jinja_env.filters["fmt_num"] = fmt_num


# ----------------------------- 鉴权辅助 -----------------------------
def current_user():
    if "username" not in session:
        return None
    conn = get_db()
    u = conn.execute(
        "SELECT * FROM suppliers WHERE username = ?", (session["username"],)
    ).fetchone()
    conn.close()
    return u


def login_required(role=None):
    def decorator(f):
        def wrap(*a, **k):
            u = current_user()
            if not u:
                return redirect(url_for("login_page"))
            if role and u["role"] != role:
                flash("无权限访问该页面", "error")
                return redirect(url_for("orders_page"))
            return f(*a, **k)
        wrap.__name__ = f.__name__
        return wrap
    return decorator


# ----------------------------- 页面路由 -----------------------------
@app.route("/")
def index():
    u = current_user()
    if not u:
        return redirect(url_for("login_page"))
    if u["role"] == "admin":
        return redirect(url_for("admin_page"))
    return redirect(url_for("orders_page"))


@app.route("/login", methods=["GET"])
def login_page():
    if current_user():
        return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login_action():
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    conn = get_db()
    u = conn.execute(
        "SELECT * FROM suppliers WHERE username = ?", (username,)
    ).fetchone()
    conn.close()
    if u and check_password_hash(u["password_hash"], password):
        session["username"] = u["username"]
        session["role"] = u["role"]
        session["supplier_key"] = u["supplier_key"]
        return redirect(url_for("index"))
    flash("用户名或密码错误", "error")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


@app.route("/orders")
@login_required("supplier")
def orders_page():
    u = current_user()
    conn = get_db()
    rows = conn.execute(
        """SELECT * FROM orders
           WHERE supplier_key = ?
           ORDER BY source_sheet, project_name, material""",
        (u["supplier_key"],),
    ).fetchall()
    conn.close()
    sheets = {}
    for r in rows:
        sheets.setdefault(r["source_sheet"] or "未分类", []).append(dict(r))
    return render_template(
        "orders.html",
        user=u,
        sheets=sheets,
        total=len(rows),
    )


@app.route("/api/order/<int:order_id>", methods=["POST"])
@login_required("supplier")
def update_order(order_id):
    u = current_user()
    data = request.get_json(silent=True) or {}
    reply = (data.get("supplier_reply") or "").strip()
    remarks = (data.get("remarks") or "").strip()
    conn = get_db()
    row = conn.execute(
        "SELECT id, supplier_key FROM orders WHERE id = ?", (order_id,)
    ).fetchone()
    if not row or row["supplier_key"] != u["supplier_key"]:
        conn.close()
        return jsonify({"ok": False, "msg": "无权修改该订单"}), 403
    conn.execute(
        """UPDATE orders SET supplier_reply=?, remarks=?, updated_at=(datetime('now','localtime'))
           WHERE id=?""",
        (reply, remarks, order_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "updated_at": "刚刚"})


# ----------------------------- 管理员路由 -----------------------------
@app.route("/admin")
@login_required("admin")
def admin_page():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM orders ORDER BY source_sheet, supplier_key"
    ).fetchall()
    suppliers = conn.execute(
        "SELECT * FROM suppliers ORDER BY role DESC, supplier_key"
    ).fetchall()
    conn.close()
    return render_template(
        "admin.html",
        user=current_user(),
        rows=[dict(r) for r in rows],
        suppliers=[dict(s) for s in suppliers],
        total=len(rows),
    )


@app.route("/admin/import", methods=["POST"])
@login_required("admin")
def admin_import():
    import seed
    try:
        seed.main()
        flash("已重新从 Excel 导入数据", "success")
    except Exception as e:  # noqa
        flash(f"导入失败：{e}", "error")
    return redirect(url_for("admin_page"))


@app.route("/admin/supplier", methods=["POST"])
@login_required("admin")
def admin_add_supplier():
    name = (request.form.get("supplier_name") or "").strip()
    pwd = (request.form.get("password") or "").strip() or "Scm@2026"
    if not name:
        flash("供应商名称不能为空", "error")
        return redirect(url_for("admin_page"))
    key = name  # 手动添加时不强制归一化；如需归一化可调用 normalize_supplier
    conn = get_db()
    exist = conn.execute(
        "SELECT id FROM suppliers WHERE supplier_key = ? OR username = ?",
        (key, name),
    ).fetchone()
    if exist:
        flash(f"供应商“{name}”已存在", "error")
    else:
        conn.execute(
            "INSERT INTO suppliers (supplier_key, display_name, username, password_hash, role) VALUES (?,?,?,?,?)",
            (key, name, name, generate_password_hash(pwd), "supplier"),
        )
        conn.commit()
        flash(f"已创建供应商账号：{name}（默认密码 {pwd}）", "success")
    conn.close()
    return redirect(url_for("admin_page"))


@app.route("/admin/reset-password", methods=["POST"])
@login_required("admin")
def admin_reset_password():
    uid = request.form.get("user_id")
    pwd = (request.form.get("password") or "").strip()
    if not pwd:
        flash("密码不能为空", "error")
        return redirect(url_for("admin_page"))
    conn = get_db()
    conn.execute(
        "UPDATE suppliers SET password_hash = ? WHERE id = ?",
        (generate_password_hash(pwd), uid),
    )
    conn.commit()
    conn.close()
    flash("密码已重置", "success")
    return redirect(url_for("admin_page"))


HOST = os.environ.get("HOST", "0.0.0.0")

if __name__ == "__main__":
    init_db()
    print(f"启动服务（局域网可访问）： http://{HOST}:{PORT}  （Ctrl+C 停止）")
    print(f"本公司同事请访问： http://你的内网IP:{PORT}  （用 ipconfig 查本机 IPv4 地址）")
    app.run(host=HOST, port=PORT, debug=False)
