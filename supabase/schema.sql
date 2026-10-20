-- ============================================================
-- 中压物料交期跟进 · 供应商交付门户 —— Supabase 数据库结构
-- 适用：Supabase 项目（PostgreSQL）
-- 用法：Supabase 控制台 -> SQL Editor -> 粘贴本文件 -> Run
-- 说明：本文件【可重复执行】，会自动清理旧对象再重建。数据由 scripts/import_to_supabase.py 导入。
-- ============================================================

-- 生成 UUID 所需扩展（Supabase 默认已带，保险起见）
create extension if not exists "pgcrypto";

-- ============================================================
-- 0) 幂等清理（可重复执行本文件）
--    说明：执行过一次后再执行，会先删除旧对象再重建。
--    此时尚未导入业务数据，删除是安全的。
-- ============================================================
drop view  if exists public.supplier_login_map;
drop policy if exists "suppliers_select_self" on public.suppliers;
drop policy if exists "suppliers_all_admin"  on public.suppliers;
drop policy if exists "orders_select_supplier" on public.orders;
drop policy if exists "orders_update_supplier" on public.orders;
drop policy if exists "orders_all_admin"      on public.orders;
drop policy if exists "sheet_columns_select_auth" on public.sheet_columns;
drop policy if exists "sheet_columns_all_admin"  on public.sheet_columns;
drop policy if exists "audit_insert_supplier" on public.audit_log;
drop policy if exists "audit_select_supplier" on public.audit_log;
drop policy if exists "audit_all_admin"      on public.audit_log;
drop policy if exists "announcements_select_auth" on public.announcements;
drop policy if exists "announcements_all_admin"  on public.announcements;
drop trigger if exists trg_orders_supplier_guard on public.orders;
drop function if exists public.orders_supplier_update_guard();
drop function if exists public.current_supplier_key();
drop function if exists public.is_admin();
drop table if exists public.audit_log        cascade;
drop table if exists public.sheet_columns    cascade;
drop table if exists public.announcements    cascade;
drop table if exists public.orders           cascade;
drop table if exists public.suppliers        cascade;

-- ============================================================
-- 1) 供应商账号表
--    - supplier_key：归一化后的供应商名称，用于与订单匹配
--    - login_email：Supabase Auth 登录邮箱（占位格式 key@portal.local）
--    - auth_user_id：关联 auth.users.id（Supabase 认证用户）
--    - role：supplier | admin
-- ============================================================
create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  supplier_key  text unique not null,
  display_name  text not null,
  login_email   text unique not null,
  auth_user_id  uuid unique,
  role          text not null default 'supplier' check (role in ('supplier','admin')),
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 2) 订单表
--    列与原 Excel 保持一致：
--    - 核心列：日期/采购凭证/供应订单号/供应商/物料描述/采购数量/
--              采购交货/供货交货/需求 等
--    - extra：各工作表其余列以 JSON 存储（列名清单见 sheet_columns）
--    - 供应商可编辑：delivery_status(是否可以按时交付) /
--              supplier_reply(供应商回复) / remarks(备注)
--    - supplier_reply_time：供应商保存时自动记录
-- ============================================================
create table if not exists public.orders (
  id                 bigint generated always as identity primary key,
  source_sheet       text not null,
  supplier_key       text not null references public.suppliers(supplier_key),
  supplier_name      text,
  order_date         text,              -- 日期
  doc_no             text,              -- 采购凭证/订单号
  supplier_order_no  text,              -- 供应订单号
  project_name       text,              -- 项目名称（旧表）
  material           text,              -- 物料
  short_text         text,              -- 短文本/物料描述
  qty_ordered        numeric,           -- 采购数量
  qty_outstanding    numeric,           -- 仍要交货/待交
  delivery_status    text not null default '',   -- 是否可以按时交付
  supplier_reply     text not null default '',   -- 供应商回复
  supplier_reply_time timestamptz,               -- 供应商回复时间
  remarks            text not null default '',   -- 备注
  extra              jsonb not null default '{}'::jsonb,
  -- 内容指纹：由「项目+订单号+物料+供应商+数量+日期+其它列」整体计算
  -- 指纹相同 -> 同一条记录（覆盖更新）；指纹不同 -> 各自独立成行（都保留）
  row_key            text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

-- 唯一键改为内容指纹（保证同订单号+物料下的不同项目/数量/需求日期可并存）
create unique index orders_row_key on public.orders (row_key);
-- 供应商过滤的查询索引
create index orders_supplier_idx on public.orders (supplier_key);
create index orders_sheet_idx    on public.orders (source_sheet);

-- ============================================================
-- 3) 工作表列清单（保证前端展示列顺序与原 Excel 一致）
--    columns: 有序列表 ["日期","供应商名称",...,"备注"]
-- ============================================================
create table if not exists public.sheet_columns (
  source_sheet  text primary key,
  columns       jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- 4) 审计日志表（谁、何时、改了哪条记录的哪个字段）
-- ============================================================
create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  -- 订单被替换/删除时，其修改记录一并清理，避免外键报错
  order_id      bigint references public.orders(id) on delete cascade,
  supplier_key  text,
  changed_by    uuid,
  changed_by_name text,
  field         text not null,
  old_value     text,
  new_value     text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 5) 全局公告表（管理员发布，所有供应商登录可见，含历史）
-- ============================================================
create table if not exists public.announcements (
  id            bigint generated always as identity primary key,
  title         text not null,
  content       text not null default '',
  created_by_name text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 6) 辅助函数（当前登录用户的供应商标识 / 是否管理员）
-- ============================================================
create or replace function public.current_supplier_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select supplier_key from public.suppliers where auth_user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.suppliers
    where auth_user_id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================
-- 7) 启用行级安全（RLS）
-- ============================================================
alter table public.suppliers      enable row level security;
alter table public.orders         enable row level security;
alter table public.audit_log      enable row level security;
alter table public.announcements  enable row level security;
alter table public.sheet_columns  enable row level security;

-- ------------------------------------------------------------
-- suppliers 策略：认证用户读自己；管理员全表；匿名不读
-- ------------------------------------------------------------
create policy "suppliers_select_self" on public.suppliers
  for select using (auth_user_id = auth.uid());

create policy "suppliers_all_admin" on public.suppliers
  for all using (public.is_admin()) with check (public.is_admin());

-- 登录名 -> 邮箱 映射视图（供登录页把“供应商名称”转成登录邮箱）
create or replace view public.supplier_login_map as
  select supplier_key, display_name, login_email
  from public.suppliers;

grant select on public.supplier_login_map to anon, authenticated;

-- ------------------------------------------------------------
-- orders 策略
--   匿名：全部禁止
--   供应商：仅读/改自己 supplier_key 的行（可改列见触发器守卫）
--   管理员：全表读写
-- ------------------------------------------------------------
create policy "orders_select_supplier" on public.orders
  for select using (supplier_key = public.current_supplier_key());

create policy "orders_update_supplier" on public.orders
  for update using (supplier_key = public.current_supplier_key())
  with check (supplier_key = public.current_supplier_key());

create policy "orders_all_admin" on public.orders
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- sheet_columns：认证用户可读（供应商需要知道列顺序）
-- ------------------------------------------------------------
create policy "sheet_columns_select_auth" on public.sheet_columns
  for select using (auth.role() = 'authenticated');

create policy "sheet_columns_all_admin" on public.sheet_columns
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- audit_log 策略：供应商可查自己的修改记录；管理员全表
-- ------------------------------------------------------------
create policy "audit_insert_supplier" on public.audit_log
  for insert with check (supplier_key = public.current_supplier_key());

create policy "audit_select_supplier" on public.audit_log
  for select using (supplier_key = public.current_supplier_key());

create policy "audit_all_admin" on public.audit_log
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- announcements 策略：认证用户可读（含历史）；管理员可发布/删除
-- ------------------------------------------------------------
create policy "announcements_select_auth" on public.announcements
  for select using (auth.role() = 'authenticated');

create policy "announcements_all_admin" on public.announcements
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 8) 触发器守卫：即使绕过前端，供应商也只能改三个字段
--    是否可以按时交付 / 供应商回复 / 备注（+自动回复时间）
-- ============================================================
create or replace function public.orders_supplier_update_guard()
returns trigger
language plpgsql
as $$
begin
  if not public.is_admin() then
    if (new.source_sheet        is distinct from old.source_sheet)    or
       (new.supplier_key        is distinct from old.supplier_key)    or
       (new.supplier_name       is distinct from old.supplier_name)   or
       (new.order_date          is distinct from old.order_date)      or
       (new.doc_no              is distinct from old.doc_no)          or
       (new.supplier_order_no   is distinct from old.supplier_order_no) or
       (new.project_name        is distinct from old.project_name)    or
       (new.material            is distinct from old.material)        or
       (new.short_text          is distinct from old.short_text)      or
       (new.qty_ordered         is distinct from old.qty_ordered)     or
       (new.qty_outstanding     is distinct from old.qty_outstanding) or
       (new.extra               is distinct from old.extra)           or
       (new.supplier_reply_time is distinct from old.supplier_reply_time
         and (new.supplier_reply_time is null
              or abs(extract(epoch from (now() - new.supplier_reply_time))) > 300)) then
      raise exception '供应商仅可修改「是否可以按时交付 / 供应商回复 / 备注」';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_supplier_guard on public.orders;
create trigger trg_orders_supplier_guard
  before update on public.orders
  for each row execute function public.orders_supplier_update_guard();
