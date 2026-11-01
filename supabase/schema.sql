-- =====================================================================
-- FRAMEO — مخطط قاعدة البيانات والصلاحيات (Supabase / PostgreSQL)
-- شغّل هذا الملف كاملاً مرة واحدة من: Supabase Dashboard → SQL Editor
-- آمن لإعادة التشغيل (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الجداول
-- ---------------------------------------------------------------------

-- حسابات الإدارة (مرتبطة بحسابات Supabase Auth).
-- لا أحد يقدر يضيف/يعدّل صفوفها من المتصفح؛ التعديل فقط عبر Edge Function
-- (admin-users) بصلاحية service_role، ولا يستخدمها إلا حساب owner.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  role         text not null default 'admin' check (role in ('owner', 'admin')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- الفريمات
create table if not exists public.frames (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text not null check (char_length(name) between 1 and 120),
  visibility  text not null default 'public' check (visibility in ('public', 'private')),
  -- مفتاح الوصول للفريمات الخاصة فقط (لا يُقرأ من الزوار أبداً)
  access_key  text,
  -- مسار الصورة داخل bucket اسمه frames (PNG / SVG / WEBP / JPG)
  image_path  text not null,
  -- باقي الإعدادات: الأبعاد، منطقة الصورة، النصوص، الملصقات، ترتيب الطبقات
  config      jsonb not null default '{}'::jsonb,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint frames_key_rule check (
    (visibility = 'public'  and access_key is null)
    or
    (visibility = 'private' and access_key is not null and char_length(access_key) >= 16)
  )
);

create or replace function public.touch_frame()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists frames_touch on public.frames;
create trigger frames_touch
  before update on public.frames
  for each row execute function public.touch_frame();

-- ---------------------------------------------------------------------
-- 2) دوال مساعدة للصلاحيات
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'owner'
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_owner() from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_owner() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.frames   enable row level security;

-- profiles: كل حساب يقرأ صفّه فقط، والـ owner يقرأ الكل. لا كتابة من المتصفح.
drop policy if exists profiles_read_self  on public.profiles;
drop policy if exists profiles_read_owner on public.profiles;
create policy profiles_read_self  on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_read_owner on public.profiles
  for select to authenticated using (public.is_owner());

-- frames: الزوار يرون الفريمات العامة فقط
drop policy if exists frames_public_read  on public.frames;
drop policy if exists frames_admin_read   on public.frames;
drop policy if exists frames_admin_insert on public.frames;
drop policy if exists frames_admin_update on public.frames;
drop policy if exists frames_admin_delete on public.frames;

create policy frames_public_read on public.frames
  for select to anon, authenticated
  using (visibility = 'public');

-- الإدارة ترى وتعدّل كل شيء (العامة + الخاصة)
create policy frames_admin_read   on public.frames
  for select to authenticated using (public.is_admin());
create policy frames_admin_insert on public.frames
  for insert to authenticated with check (public.is_admin());
create policy frames_admin_update on public.frames
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy frames_admin_delete on public.frames
  for delete to authenticated using (public.is_admin());

-- صلاحيات الأعمدة: الزائر (anon) لا يقدر يقرأ عمود access_key إطلاقاً
revoke all on public.frames   from anon, authenticated;
revoke all on public.profiles from anon, authenticated;

grant select (id, name, visibility, image_path, config, sort_order, created_at, updated_at)
  on public.frames to anon;
grant select, insert, update, delete on public.frames to authenticated;
grant select on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 4) الفريم الخاص: يُجلب فقط بمعرّفه + مفتاحه الصحيح
-- ---------------------------------------------------------------------
create or replace function public.get_private_frame(p_id text, p_key text)
returns table (
  id          text,
  name        text,
  visibility  text,
  image_path  text,
  config      jsonb,
  sort_order  integer,
  created_at  timestamptz,
  updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.visibility, f.image_path, f.config, f.sort_order, f.created_at, f.updated_at
  from public.frames f
  where f.id = p_id
    and f.visibility = 'private'
    and p_key is not null
    and f.access_key = p_key;
$$;

revoke all on function public.get_private_frame(text, text) from public;
grant execute on function public.get_private_frame(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) تخزين الصور (Storage): الرفع للإدارة فقط
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'frames', 'frames', true, 15728640,
  array['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists frames_bucket_admin_read   on storage.objects;
drop policy if exists frames_bucket_admin_insert on storage.objects;
drop policy if exists frames_bucket_admin_update on storage.objects;
drop policy if exists frames_bucket_admin_delete on storage.objects;

create policy frames_bucket_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'frames' and public.is_admin());
create policy frames_bucket_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'frames' and public.is_admin());
create policy frames_bucket_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'frames' and public.is_admin())
  with check (bucket_id = 'frames' and public.is_admin());
create policy frames_bucket_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'frames' and public.is_admin());

-- ---------------------------------------------------------------------
-- 6) إنشاء أول حساب owner (نفّذ بعد إنشاء المستخدم من Authentication → Users)
--    غيّر الإيميل ثم شغّل السطرين التاليين مرة واحدة:
-- ---------------------------------------------------------------------
-- insert into public.profiles (id, email, display_name, role)
-- select id, email, 'المالك', 'owner' from auth.users where email = 'YOUR_EMAIL@example.com'
-- on conflict (id) do update set role = 'owner', active = true;
