// ============================================================
// orders.js —— 供应商「我的订单」
//  - 按 source_sheet 分项目标签页
//  - 列顺序与原 Excel 一致（读取 sheet_columns）
//  - 行内编辑：是否可以按时交付(select) / 供应商回复 / 备注
//  - 保存时自动写 supplier_reply_time + audit_log
//  - 搜索 / 状态筛选 / 批量填写 / 修改记录
// ============================================================
"use strict";

// 列名 -> 数据字段（其余列自动落入 extra）
window.COLMAP = {
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
  "供应商回复时间": "supplier_reply_time",
  "供应商回复": "supplier_reply",
  "备注": "remarks"
};

window.Orders = {
  rows: [],            // 我的全量订单
  sheetCols: {},       // { sheet名: [列名...] }
  activeSheet: null,
  checked: new Set(),  // 当前标签页勾选的订单 id

  // ---------- 数据加载 ----------
  async loadAll() {
    const [oRes, cRes] = await Promise.all([
      sb.from("orders").select("*").order("id", { ascending: true }),
      sb.from("sheet_columns").select("*")
    ]);
    if (oRes.error) throw oRes.error;
    if (cRes.error) throw cRes.error;
    this.rows = oRes.data || [];
    this.sheetCols = {};
    (cRes.data || []).forEach(r => { this.sheetCols[r.source_sheet] = r.columns || []; });
    const sheets = [...new Set(this.rows.map(r => r.source_sheet))];
    this.activeSheet = sheets[0] || null;
    this.checked.clear();
    return sheets;
  },

  // ---------- 渲染标签页 ----------
  renderTabs() {
    const sheets = [...new Set(this.rows.map(r => r.source_sheet))];
    const el = document.getElementById("tabs");
    el.innerHTML = sheets.map(s => {
      const n = this.rows.filter(r => r.source_sheet === s).length;
      return `<button class="tab ${s === this.activeSheet ? "active" : ""}" data-sheet="${esc(s)}">
        ${esc(s)}<span class="cnt">(${n})</span></button>`;
    }).join("");
    el.querySelectorAll(".tab").forEach(btn => {
      btn.onclick = () => { this.activeSheet = btn.dataset.sheet; this.checked.clear(); this.renderTabs(); this.renderTable(); };
    });
  },

  // 取某行某列的值
  fieldValue(row, colName) {
    const f = COLMAP[colName];
    if (f) {
      if (f === "supplier_reply_time") return fmtTime(row.supplier_reply_time);
      return row[f];
    }
    return row.extra ? row.extra[colName] : "";
  },
  isEditable(colName) {
    return colName === "delivery_status" || colName === "supplier_reply" || colName === "remarks";
  },

  // ---------- 渲染表格 ----------
  renderTable() {
    const wrap = document.getElementById("orders-table-wrap");
    const cols = this.sheetCols[this.activeSheet] || [];
    const kw = (document.getElementById("orders-search").value || "").trim().toLowerCase();
    const stFilter = document.getElementById("orders-status-filter").value;

    let list = this.rows.filter(r => r.source_sheet === this.activeSheet);
    if (kw) list = list.filter(r =>
      [r.doc_no, r.supplier_order_no, r.material, r.short_text, r.project_name]
        .some(v => String(v || "").toLowerCase().includes(kw)));
    if (stFilter) list = list.filter(r => (r.delivery_status || "") === stFilter);

    if (!cols.length) { // 无列清单时退化为核心列
      cols.push("日期", "供应商名称", "采购凭证", "供应订单号", "物料", "物料描述", "采购数量",
        "是否可以按时交付", "供应商回复", "备注");
    }

    const statusCell = row => {
      const v = row.delivery_status || "";
      const cls = STATUS_CLASS[v] || "";
      const opts = ['<option value=""></option>']
        .concat(DELIVERY_OPTIONS.map(o =>
          `<option value="${o}" ${o === v ? "selected" : ""}>${o}</option>`));
      return `<select class="cell-select status-select ${cls}" data-id="${row.id}" data-col="delivery_status">${opts.join("")}</select>`;
    };

    const textCell = (row, col, isArea) => {
      const v = esc(this.fieldValue(row, col));
      return isArea
        ? `<textarea class="cell-input cell-textarea" rows="2" data-id="${row.id}" data-col="${col}">${v}</textarea>`
        : `<input class="cell-input" data-id="${row.id}" data-col="${col}" value="${v}" />`;
    };

    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th class="col-check"><input type="checkbox" id="chk-all" title="全选/取消" /></th>
          ${cols.map(c => `<th>${esc(c)}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${list.length ? list.map(row => `<tr data-row="${row.id}">
            <td class="col-check"><input type="checkbox" class="chk-row" data-id="${row.id}" ${this.checked.has(row.id) ? "checked" : ""} /></td>
            ${cols.map(c => {
              if (c === "delivery_status") return `<td>${statusCell(row)}</td>`;
              if (c === "supplier_reply") return `<td>${textCell(row, c, true)}</td>`;
              if (c === "remarks") return `<td>${textCell(row, c, true)}</td>`;
              const v = esc(this.fieldValue(row, c));
              const isNum = ["qty_ordered", "qty_outstanding"].includes(COLMAP[c]);
              return `<td class="${isNum ? "num" : ""}" style="${this.isEditable(c) ? "" : "white-space:pre-wrap;min-width:70px"}">${v}</td>`;
            }).join("")}
          </tr>`).join("") : `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:var(--muted);padding:30px">暂无订单数据</td></tr>`}
        </tbody>
      </table>`;

    // 勾选
    wrap.querySelectorAll(".chk-row").forEach(cb => {
      cb.onchange = () => {
        const id = Number(cb.dataset.id);
        cb.checked ? this.checked.add(id) : this.checked.delete(id);
        cb.closest("tr").classList.toggle("row-checked", cb.checked);
      };
    });
    const chkAll = wrap.querySelector("#chk-all");
    if (chkAll) chkAll.onchange = () => {
      wrap.querySelectorAll(".chk-row").forEach(cb => {
        cb.checked = chkAll.checked;
        const id = Number(cb.dataset.id);
        cb.checked ? this.checked.add(id) : this.checked.delete(id);
        cb.closest("tr").classList.toggle("row-checked", cb.checked);
      });
    };

    // 行内编辑保存（失焦触发）
    wrap.querySelectorAll(".cell-input, .cell-select").forEach(input => {
      const id = Number(input.dataset.id);
      const col = input.dataset.col;
      if (input.tagName === "SELECT") {
        input.onchange = () => this.saveCell(id, col, input.value);
      } else {
        input.onblur = () => this.saveCell(id, col, input.value);
        input.onkeydown = e => { if (e.key === "Enter" && input.tagName === "INPUT") input.blur(); };
      }
    });

    // 状态下拉颜色联动
    wrap.querySelectorAll(".status-select").forEach(sel => {
      sel.className = "cell-select status-select " + (STATUS_CLASS[sel.value] || "");
      sel.addEventListener("change", () => {
        sel.className = "cell-select status-select " + (STATUS_CLASS[sel.value] || "");
      });
    });
  },

  // ---------- 保存单元格 ----------
  async saveCell(id, col, value) {
    const row = this.rows.find(r => r.id === id);
    if (!row) return;
    const oldVal = col === "delivery_status" ? (row.delivery_status || "") : (row[col] || "");
    const newVal = String(value || "");
    if (oldVal === newVal) return;

    const patch = { [col]: newVal, supplier_reply_time: new Date().toISOString() };
    const { error } = await sb.from("orders").update(patch).eq("id", id);
    if (error) { handleErr(error, "保存失败"); this.renderTable(); return; }

    // 写审计日志
    await sb.from("audit_log").insert({
      order_id: id, supplier_key: Auth.me.supplier_key,
      changed_by_name: Auth.me.display_name || Auth.me.supplier_key,
      field: col, old_value: oldVal, new_value: newVal
    });

    row[col] = newVal;
    row.supplier_reply_time = patch.supplier_reply_time;
    toast("已保存", "ok");
    // 更新状态列颜色（不重绘表格，避免输入中断）
    if (col === "delivery_status") {
      const sel = document.querySelector(`select[data-id="${id}"][data-col="delivery_status"]`);
      if (sel) sel.className = "cell-select status-select " + (STATUS_CLASS[newVal] || "");
    }
  },

  // ---------- 批量填写 ----------
  async applyBatch(status, reply, remarks) {
    const ids = [...this.checked];
    if (!ids.length) throw new Error("请先勾选要修改的行");
    if (!status && !reply && !remarks) throw new Error("请至少填写一项要修改的内容");
    const patch = { supplier_reply_time: new Date().toISOString() };
    if (status) patch.delivery_status = status;
    if (reply) patch.supplier_reply = reply;
    if (remarks) patch.remarks = remarks;

    const { error } = await sb.from("orders").update(patch).in("id", ids);
    if (error) throw error;

    // 审计
    const logs = ids.map(id => ({
      order_id: id, supplier_key: Auth.me.supplier_key,
      changed_by_name: Auth.me.display_name || Auth.me.supplier_key,
      field: "batch_fill", old_value: "", new_value: JSON.stringify(patch)
    }));
    await sb.from("audit_log").insert(logs);

    this.rows = this.rows.map(r => ids.includes(r.id) ? { ...r, ...patch } : r);
    this.checked.clear();
    this.renderTable();
  },

  // ---------- 修改记录 ----------
  async showAudit() {
    const { data, error } = await sb.from("audit_log")
      .select("*, orders(doc_no, material)")
      .order("created_at", { ascending: false }).limit(200);
    if (error) { handleErr(error, "读取修改记录失败"); return; }
    const el = document.getElementById("audit-list");
    const FIELD_NAME = { delivery_status: "是否可以按时交付", supplier_reply: "供应商回复", remarks: "备注", batch_fill: "批量填写" };
    el.innerHTML = (data && data.length) ? data.map(a => `
      <div class="audit-item">
        <div class="meta">${fmtTime(a.created_at)} · 订单 ${esc(a.orders ? a.orders.doc_no : a.order_id)} · 字段：${FIELD_NAME[a.field] || esc(a.field)}</div>
        ${a.field === "batch_fill"
          ? `<div class="diff">批量应用：${esc(a.new_value)}</div>`
          : `<div class="diff"><span class="old">${esc(a.old_value)}</span> → <b>${esc(a.new_value)}</b></div>`}
      </div>`).join("")
      : `<div style="text-align:center;color:var(--muted);padding:20px">还没有修改记录</div>`;
    document.getElementById("modal-audit").classList.remove("hidden");
  }
};
