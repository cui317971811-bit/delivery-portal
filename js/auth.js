// ============================================================
// auth.js —— 登录 / 退出 / 修改密码 / 当前用户信息
// 供应商用「供应商名称」登录：前端先通过 supplier_login_map
// 把名称映射为占位邮箱，再用邮箱+密码走 Supabase Auth。
// ============================================================
"use strict";

window.Auth = {
  me: null,            // { supplier_key, display_name, role }

  // 登录成功后加载 suppliers 表中自己的信息
  async loadMe() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb.from("suppliers")
      .select("supplier_key, display_name, role").eq("auth_user_id", user.id).single();
    if (error) { console.error(error); return null; }
    this.me = data;
    return data;
  },

  // 登录：供应商名称 -> 邮箱 -> signInWithPassword
  async login(name, password) {
    const key = name.trim();
    const { data, error } = await sb.from("supplier_login_map")
      .select("login_email, supplier_key").eq("supplier_key", key).maybeSingle();
    if (error || !data) throw new Error("找不到该供应商名称，请确认输入（需与表内完全一致）");
    const { error: sErr } = await sb.auth.signInWithPassword({
      email: data.login_email, password
    });
    if (sErr) {
      if (String(sErr.message).includes("Invalid login")) throw new Error("密码错误，请重试");
      throw sErr;
    }
    return this.loadMe();
  },

  async logout() { await sb.auth.signOut(); this.me = null; },

  // 修改密码（登录状态下）
  async changePassword(oldPwd, newPwd) {
    // 先用旧密码验证身份
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error("登录状态已失效，请重新登录");
    const { data: map } = await sb.from("supplier_login_map")
      .select("login_email").eq("supplier_key", this.me.supplier_key).maybeSingle();
    const { error: vErr } = await sb.auth.signInWithPassword({
      email: (map && map.login_email) || user.email, password: oldPwd
    });
    if (vErr) throw new Error("当前密码不正确");
    const { error } = await sb.auth.updateUser({ password: newPwd });
    if (error) throw error;
  }
};
