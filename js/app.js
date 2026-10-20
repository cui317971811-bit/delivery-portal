// ============================================================
// app.js —— 应用入口：路由 / 视图切换 / 事件绑定 / 公告条
// ============================================================
"use strict";

(function () {
  const $ = id => document.getElementById(id);

  function show(view) {
    ["view-login", "view-orders", "view-admin"].forEach(v => $(v).classList.add("hidden"));
    $("topbar").classList.add("hidden");
    $("notice-bar").classList.add("hidden");
    if (view === "login") {
      $("view-login").classList.remove("hidden");
    } else {
      $("topbar").classList.remove("hidden");
      $("user-name").textContent = Auth.me ? Auth.me.display_name : "";
      if (view === "orders") $("view-orders").classList.remove("hidden");
      if (view === "admin") $("view-admin").classList.remove("hidden");
      loadNotices();
    }
  }

  // ---------- 登录 ----------
  $("form-login").addEventListener("submit", async e => {
    e.preventDefault();
    $("login-msg").textContent = "";
    try {
      await Auth.login($("login-name").value, $("login-pwd").value);
      afterLogin();
    } catch (err) {
      $("login-msg").textContent = err.message || "登录失败";
    }
  });

  async function afterLogin() {
    if (!Auth.me) { show("login"); return; }
    if (Auth.me.role === "admin") {
      show("admin");
      try { await Admin.loadAll(); Admin.render("orders"); }
      catch (e) { handleErr(e, "加载数据失败"); }
    } else {
      show("orders");
      try {
        await Orders.loadAll();
        Orders.renderTabs();
        Orders.renderTable();
      } catch (e) { handleErr(e, "加载订单失败"); }
    }
  }

  // ---------- 退出 ----------
  $("btn-logout").onclick = async () => { await Auth.logout(); show("login"); };

  // ---------- 修改密码 ----------
  $("btn-change-pwd").onclick = () => { $("pwd-msg").textContent = ""; $("modal-pwd").classList.remove("hidden"); };
  $("btn-pwd-cancel").onclick = () => $("modal-pwd").classList.add("hidden");
  $("form-pwd").addEventListener("submit", async e => {
    e.preventDefault();
    const o = $("pwd-old").value, n = $("pwd-new").value, n2 = $("pwd-new2").value;
    if (n !== n2) { $("pwd-msg").textContent = "两次输入的新密码不一致"; return; }
    try {
      await Auth.changePassword(o, n);
      $("modal-pwd").classList.add("hidden");
      toast("密码已修改", "ok");
    } catch (err) {
      $("pwd-msg").textContent = err.message || "修改失败";
    }
  });

  // ---------- 供应商：搜索/筛选/批量/审计 ----------
  $("orders-search").addEventListener("input", () => Orders.renderTable());
  $("orders-status-filter").addEventListener("change", () => Orders.renderTable());
  $("btn-audit").onclick = () => Orders.showAudit();
  $("btn-audit-close").onclick = () => $("modal-audit").classList.add("hidden");
  $("btn-batch-fill").onclick = () => {
    $("batch-msg").textContent = "";
    $("batch-status").value = ""; $("batch-reply").value = ""; $("batch-remarks").value = "";
    $("modal-batch").classList.remove("hidden");
  };
  $("btn-batch-cancel").onclick = () => $("modal-batch").classList.add("hidden");
  $("btn-batch-save").onclick = async () => {
    try {
      await Orders.applyBatch($("batch-status").value, $("batch-reply").value.trim(), $("batch-remarks").value.trim());
      $("modal-batch").classList.add("hidden");
      toast("批量填写完成", "ok");
    } catch (err) {
      $("batch-msg").textContent = err.message || "操作失败";
    }
  };

  // ---------- 管理员：标签页 / 导出 / 刷新 ----------
  document.querySelectorAll(".admin-tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".admin-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      ["orders", "suppliers", "audit", "announcements", "import"].forEach(t => {
        $("admin-" + t).classList.toggle("hidden", t !== btn.dataset.tab);
      });
      Admin.render(btn.dataset.tab);
    };
  });
  $("btn-export-csv").onclick = () => Admin.exportData("csv");
  $("btn-export-xlsx").onclick = () => Admin.exportData("xlsx");
  $("btn-refresh-admin").onclick = async () => {
    try { await Admin.loadAll(); Admin.render("orders"); toast("已刷新", "ok"); }
    catch (e) { handleErr(e, "刷新失败"); }
  };

  // ---------- 公告条 ----------
  async function loadNotices() {
    const { data, error } = await sb.from("announcements")
      .select("*").order("created_at", { ascending: false }).limit(1);
    if (error || !data || !data.length) return;
    $("notice-title").textContent = data[0].title;
    $("notice-content").textContent = data[0].content || "";
    $("notice-content").classList.add("hidden");
    $("notice-bar").classList.remove("hidden");
  }
  $("btn-notice-close").onclick = () => $("notice-bar").classList.add("hidden");
  $("btn-notice-history").onclick = async () => {
    const { data, error } = await sb.from("announcements")
      .select("*").order("created_at", { ascending: false }).limit(30);
    if (error) { handleErr(error, "读取公告失败"); return; }
    const el = $("audit-list");
    el.innerHTML = (data || []).map(a => `
      <div class="audit-item">
        <div class="meta">${fmtTime(a.created_at)} · ${esc(a.created_by_name || "")}</div>
        <div><b>${esc(a.title)}</b></div>
        <div style="white-space:pre-wrap">${esc(a.content)}</div>
      </div>`).join("") || `<div style="text-align:center;color:var(--muted);padding:20px">暂无公告</div>`;
    $("modal-audit").classList.remove("hidden");
  };

  // ---------- 启动：已登录则直接进入 ----------
  (async function boot() {
    if (!window.SUPABASE_URL || String(window.SUPABASE_URL).includes("YOUR-PROJECT")) {
      $("login-msg").textContent = "尚未配置 js/config.js（请复制 config.example.js 并填入 Supabase 地址）。";
    }
    try {
      const me = await Auth.loadMe();
      if (me) afterLogin(); else show("login");
    } catch (e) {
      console.error(e);
      show("login");
    }
  })();
})();
