// ============================================================
// admin.js —— 管理后台
//  - 全部订单（统计 + 只读表格 + 搜索）
//  - 供应商账号一览
//  - 修改记录（全员）
//  - 公告管理（发布 / 历史 / 删除）
//  - 导出 CSV / Excel(.xlsx)
//  - 数据导入说明
// ============================================================
"use strict";

window.Admin = {
  orders: [], suppliers: [], sheets: [], activeSheet: "__ALL__",
  kw: "",

  async loadAll() {
    const [o, s, sc] = await Promise.all([
      sb.from("orders").select("*").order("source_sheet").order("id"),
      sb.from("suppliers").select("*").order("supplier_key"),
      sb.from("sheet_columns").select("*")
    ]);
    if (o.error) throw o.error;
    if (s.error) throw s.error;
    this.orders = o.data || [];
    this.suppliers = s.data || [];
    this.sheets = [...new Set(this.orders.map(r => r.source_sheet))];
    this.colMap = {};
    (sc.data || []).forEach(r => { this.colMap[r.source_sheet] = r.columns || []; });
  },

  filtered() {
    let list = this.activeSheet === "__ALL__" ? this.orders
      : this.orders.filter(r => r.source_sheet === this.activeSheet);
    if (this.kw) {
      const k = this.kw.toLowerCase();
      list = list.filter(r => [r.doc_no, r.supplier_order_no, r.material, r.short_text,
        r.supplier_name, r.project_name].some(v => String(v || "").toLowerCase().includes(k)));
    }
    return list;
  },

  // ---------- 主渲染 ----------
  render(tab) {
    if (tab === "orders") this.renderOrders();
    else if (tab === "suppliers") this.renderSuppliers();
    else if (tab === "audit") this.renderAudit();
    else if (tab === "announcements") this.renderAnnouncements();
    else if (tab === "import") this.renderImport();
  },

  // ---------- 全部订单 ----------
  renderOrders() {
    const el = document.getElementById("admin-orders");
    const list = this.filtered();
    const done = list.filter(r => r.delivery_status).length;
    const delay = list.filter(r => r.delivery_status === "延期").length;
    const sheetOpts = ['<option value="__ALL__">全部项目</option>']
      .concat(this.sheets.map(s => `<option value="${esc(s)}" ${s === this.activeSheet ? "selected" : ""}>${esc(s)}</option>`));

    const cols = ["source_sheet", "doc_no", "supplier_name", "material", "short_text",
      "qty_ordered", "delivery_status", "supplier_reply", "supplier_reply_time", "remarks"];
    const HEAD = { source_sheet: "项目", doc_no: "采购凭证", supplier_name: "供应商",
      material: "物料", short_text: "物料描述", qty_ordered: "采购数量",
      delivery_status: "是否可以按时交付", supplier_reply: "供应商回复",
      supplier_reply_time: "回复时间", remarks: "备注" };

    el.innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="k">订单总数</div><div class="v">${list.length}</div></div>
        <div class="stat-card"><div class="k">已反馈</div><div class="v">${done}</div></div>
        <div class="stat-card"><div class="k">延期</div><div class="v" style="color:#dc2626">${delay}</div></div>
        <div class="stat-card"><div class="k">供应商数</div><div class="v">${this.suppliers.filter(s => s.role === "supplier").length}</div></div>
      </div>
      <div class="actions" style="margin-bottom:10px">
        <select id="adm-sheet" class="search-input">${sheetOpts.join("")}</select>
        <input id="adm-kw" class="search-input" placeholder="搜索订单/物料/供应商…" value="${esc(this.kw)}" />
      </div>
      <div class="table-wrap"><table>
        <thead><tr>${cols.map(c => `<th>${HEAD[c]}</th>`).join("")}</tr></thead>
        <tbody>${list.slice(0, 500).map(r => `<tr>
          <td>${esc(r.source_sheet)}</td><td>${esc(r.doc_no)}</td><td>${esc(r.supplier_name)}</td>
          <td>${esc(r.material)}</td><td style="white-space:pre-wrap;max-width:220px">${esc(r.short_text)}</td>
          <td class="num">${r.qty_ordered == null ? "" : esc(r.qty_ordered)}</td>
          <td>${r.delivery_status ? `<span class="status-select ${STATUS_CLASS[r.delivery_status] || ""}" style="padding:2px 8px;border-radius:6px">${esc(r.delivery_status)}</span>` : ""}</td>
          <td style="white-space:pre-wrap;max-width:180px">${esc(r.supplier_reply)}</td>
          <td>${fmtTime(r.supplier_reply_time)}</td>
          <td style="white-space:pre-wrap;max-width:160px">${esc(r.remarks)}</td>
        </tr>`).join("") || `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px">无数据</td></tr>`}</tbody>
      </table></div>
      ${list.length > 500 ? `<p class="hint">仅显示前 500 条，可搜索或按项目筛选缩小范围。</p>` : ""}`;

    document.getElementById("adm-sheet").onchange = e => { this.activeSheet = e.target.value; this.renderOrders(); };
    document.getElementById("adm-kw").oninput = e => { this.kw = e.target.value; this.renderOrders(); };
  },

  // ---------- 供应商账号 ----------
  renderSuppliers() {
    const el = document.getElementById("admin-suppliers");
    el.innerHTML = `
      <div class="note-box">
        账号由 <b>导入脚本</b> 按 Excel 中出现的供应商自动创建（登录名 = 供应商名称，初始密码 <code>Scm@2026</code>）。<br/>
        <b>重置某供应商密码</b>：在 Supabase 控制台 → Authentication → Users → 找到 <code>供应商key@portal.local</code> → 重置密码；<br/>
        或修改 <code>scripts/import_to_supabase.py</code> 顶部 <code>DEFAULT_PASSWORD</code> 后重新运行导入（不会影响已改过密码的账号）。
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>登录名</th><th>显示名称</th><th>角色</th><th>登录邮箱</th><th>创建时间</th></tr></thead>
        <tbody>${this.suppliers.map(s => `<tr>
          <td><b>${esc(s.supplier_key)}</b></td><td>${esc(s.display_name)}</td>
          <td>${s.role === "admin" ? "管理员" : "供应商"}</td>
          <td>${esc(s.login_email)}</td><td>${fmtTime(s.created_at)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  },

  // ---------- 修改记录 ----------
  async renderAudit() {
    const el = document.getElementById("admin-audit");
    el.innerHTML = `<p class="hint">加载中…</p>`;
    const { data, error } = await sb.from("audit_log")
      .select("*, orders(doc_no, supplier_name)")
      .order("created_at", { ascending: false }).limit(500);
    if (error) { handleErr(error, "读取失败"); return; }
    const FIELD_NAME = { delivery_status: "是否可以按时交付", supplier_reply: "供应商回复", remarks: "备注", batch_fill: "批量填写" };
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>时间</th><th>供应商</th><th>订单</th><th>字段</th><th>修改前</th><th>修改后</th></tr></thead>
      <tbody>${(data || []).map(a => `<tr>
        <td>${fmtTime(a.created_at)}</td>
        <td>${esc(a.changed_by_name || a.supplier_key)}</td>
        <td>${esc(a.orders ? a.orders.doc_no : a.order_id)}</td>
        <td>${FIELD_NAME[a.field] || esc(a.field)}</td>
        <td style="color:var(--muted);max-width:200px;white-space:pre-wrap">${esc(a.old_value)}</td>
        <td style="max-width:200px;white-space:pre-wrap">${esc(a.new_value)}</td>
      </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">暂无记录</td></tr>`}</tbody>
    </table></div>`;
  },

  // ---------- 公告管理 ----------
  async renderAnnouncements() {
    const el = document.getElementById("admin-announcements");
    el.innerHTML = `<p class="hint">加载中…</p>`;
    const { data, error } = await sb.from("announcements")
      .select("*").order("created_at", { ascending: false });
    if (error) { handleErr(error, "读取公告失败"); return; }
    el.innerHTML = `
      <div class="ann-form">
        <label style="font-weight:600">发布公告</label>
        <input id="ann-title" placeholder="公告标题" />
        <textarea id="ann-content" rows="3" placeholder="公告内容（可换行）"></textarea>
        <button id="ann-publish" class="btn-primary">发布</button>
      </div>
      <div class="ann-history">
        <div style="font-weight:600;padding:8px 0">历史公告（${(data || []).length}）</div>
        ${(data || []).map(a => `<div class="ann-item">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="t">${esc(a.title)}</span>
            <span><span class="meta">${fmtTime(a.created_at)}</span>
            <button class="btn-danger-mini" data-del="${a.id}">删除</button></span>
          </div>
          <div class="c">${esc(a.content)}</div>
        </div>`).join("") || `<div style="text-align:center;color:var(--muted);padding:20px">还没有公告</div>`}
      </div>`;

    document.getElementById("ann-publish").onclick = async () => {
      const title = document.getElementById("ann-title").value.trim();
      const content = document.getElementById("ann-content").value.trim();
      if (!title) { toast("请填写公告标题", "err"); return; }
      const { error } = await sb.from("announcements").insert({
        title, content, created_by_name: Auth.me.display_name || "管理员"
      });
      if (error) { handleErr(error, "发布失败"); return; }
      toast("公告已发布", "ok");
      this.renderAnnouncements();
    };
    el.querySelectorAll("[data-del]").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("确定删除这条公告？")) return;
        const { error } = await sb.from("announcements").delete().eq("id", btn.dataset.del);
        if (error) { handleErr(error, "删除失败"); return; }
        toast("已删除", "ok");
        this.renderAnnouncements();
      };
    });
  },

  // ---------- 数据导入说明 ----------
  renderImport() {
    const el = document.getElementById("admin-import");
    el.innerHTML = `
      <div class="note-box">
        <b>每周更新数据的方法</b>（在你自己的电脑上运行，约 1 分钟）：<br/>
        1. 把新的交期跟进表放到固定位置（文件名可变，路径在命令里指定）；<br/>
        2. 双击运行 <code>run_import.bat</code>（或命令行运行 <code>python scripts/import_to_supabase.py "F:\\新表.xlsx"</code>）；<br/>
        3. 脚本会：新增/更新的订单写入数据库；<b>供应商已填的回复/备注/状态会保留</b>；新出现的供应商自动建账号。<br/><br/>
        <b>前提</b>：已安装 Python 并运行过 <code>pip install -r scripts/requirements.txt</code>，且 <code>scripts/.env</code> 中配置了 Supabase 地址与 service_role key（详见 README）。
      </div>`;
  },

  // ---------- 导出 ----------
  exportData(fmt) {
    const list = this.filtered();
    if (!list.length) { toast("没有可导出的数据", "err"); return; }
    const HEAD = ["项目", "日期", "采购凭证", "供应订单号", "供应商", "物料", "物料描述",
      "采购数量", "仍要交货", "是否可以按时交付", "供应商回复", "供应商回复时间", "备注"];
    const rows = list.map(r => [r.source_sheet, r.order_date, r.doc_no, r.supplier_order_no,
      r.supplier_name, r.material, r.short_text, r.qty_ordered, r.qty_outstanding,
      r.delivery_status, r.supplier_reply, fmtTime(r.supplier_reply_time), r.remarks]);

    if (fmt === "csv") {
      const csv = "\uFEFF" + [HEAD].concat(rows)
        .map(r => r.map(v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","))
        .join("\r\n");
      this.download(csv, `交付数据_${this.today()}.csv`, "text/csv;charset=utf-8");
    } else {
      const ws = XLSX.utils.aoa_to_sheet([HEAD].concat(rows));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "交付数据");
      XLSX.writeFile(wb, `交付数据_${this.today()}.xlsx`);
    }
    toast(`已导出 ${list.length} 条`, "ok");
  },
  today() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; },
  download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
};
