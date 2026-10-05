-- Chạy toàn bộ file này một lần trong Supabase: SQL Editor > New query > Run

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
create table public.household_members (
  household_id uuid references public.households on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  primary key (household_id, user_id)
);
create table public.finance_data (
  household_id uuid primary key references public.households on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid,
  client text
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.finance_data enable row level security;

-- Vai trò của người đang đăng nhập trong một hộ (null nếu không thuộc hộ)
create function public.my_role(h uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from public.household_members where household_id = h and user_id = auth.uid()
$$;

create policy hh_select on public.households for select to authenticated
  using (public.my_role(id) is not null);
create policy mem_select on public.household_members for select to authenticated
  using (user_id = auth.uid() or public.my_role(household_id) = 'owner');
create policy fd_select on public.finance_data for select to authenticated
  using (public.my_role(household_id) is not null);
create policy fd_update on public.finance_data for update to authenticated
  using (public.my_role(household_id) in ('owner','editor'))
  with check (public.my_role(household_id) in ('owner','editor'));
-- Không có policy insert/delete: chỉ tạo qua hàm bên dưới.

create function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  insert into public.households(name) values (p_name) returning id into h;
  insert into public.household_members values (h, auth.uid(), 'owner');
  insert into public.finance_data(household_id) values (h);
  return h;
end $$;

create function public.add_member_by_email(p_household uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if public.my_role(p_household) is distinct from 'owner' then raise exception 'Chỉ chủ hộ mới thêm được thành viên'; end if;
  if p_role not in ('owner','editor','viewer') then raise exception 'Quyền không hợp lệ'; end if;
  select id into u from auth.users where lower(email) = lower(p_email);
  if u is null then raise exception 'Người này chưa tạo tài khoản'; end if;
  insert into public.household_members values (p_household, u, p_role)
  on conflict (household_id, user_id) do update set role = excluded.role;
end $$;

revoke execute on function public.create_household(text), public.add_member_by_email(uuid,text,text), public.my_role(uuid) from public, anon;
grant execute on function public.create_household(text), public.add_member_by_email(uuid,text,text), public.my_role(uuid) to authenticated;

-- Đồng bộ tức thời giữa các thiết bị
alter publication supabase_realtime add table public.finance_data;
