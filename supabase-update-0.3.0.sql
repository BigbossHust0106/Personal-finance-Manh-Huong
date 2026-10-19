-- Chạy sau supabase-setup.sql và supabase-update-0.0.9.sql.
-- Supabase > SQL Editor > New query > Run. Có thể chạy lại, không xoá dữ liệu.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists finance_private;
revoke all on schema finance_private from public, anon, authenticated;

create table if not exists finance_private.account_pins (
  user_id uuid primary key references auth.users on delete cascade,
  pin_hash text not null,
  failures integer not null default 0,
  locked_until timestamptz
);
create table if not exists finance_private.pin_sessions (
  user_id uuid references auth.users on delete cascade,
  session_id text not null,
  primary key (user_id, session_id)
);
revoke all on all tables in schema finance_private from public, anon, authenticated;

create or replace function public.pin_access() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    not exists (select 1 from finance_private.account_pins where user_id = auth.uid())
    or exists (select 1 from finance_private.pin_sessions
      where user_id = auth.uid() and session_id = auth.jwt()->>'session_id'))
$$;

create or replace function public.pin_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', exists(select 1 from finance_private.account_pins where user_id = auth.uid()),
    'unlocked', public.pin_access())
$$;

-- Trả về lỗi thay vì RAISE để các lần nhập sai không bị rollback.
create or replace function public.pin_unlock(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p finance_private.account_pins; sid text := auth.jwt()->>'session_id';
begin
  if auth.uid() is null or sid is null then raise exception 'Cần đăng nhập lại'; end if;
  select * into p from finance_private.account_pins where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', true); end if;
  if p.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Nhập sai quá nhiều lần. Thử lại sau 5 phút.');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or crypt(p_pin, p.pin_hash) <> p.pin_hash then
    update finance_private.account_pins set
      failures = case when p.locked_until is not null then 1 else p.failures + 1 end,
      locked_until = case when (case when p.locked_until is not null then 1 else p.failures + 1 end) >= 5
        then now() + interval '5 minutes' else null end
      where user_id = auth.uid();
    return jsonb_build_object('ok', false, 'error', 'PIN không đúng. Sau 5 lần sai sẽ tạm khoá 5 phút.');
  end if;
  update finance_private.account_pins set failures = 0, locked_until = null where user_id = auth.uid();
  insert into finance_private.pin_sessions values (auth.uid(), sid) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- p_new_pin = NULL để tắt. Đổi/tắt phải xác minh PIN hiện tại ở phía server.
create or replace function public.pin_configure(p_current_pin text, p_new_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; sid text := auth.jwt()->>'session_id';
begin
  if auth.uid() is null or sid is null then raise exception 'Cần đăng nhập lại'; end if;
  if p_new_pin is not null and p_new_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'PIN phải gồm đúng 4 chữ số.');
  end if;
  -- Khoá theo tài khoản cả khi chưa có PIN, tránh hai yêu cầu bật PIN đồng thời.
  perform 1 from auth.users where id = auth.uid() for update;
  if exists(select 1 from finance_private.account_pins where user_id = auth.uid()) then
    r := public.pin_unlock(p_current_pin);
    if not (r->>'ok')::boolean then return r; end if;
  end if;
  delete from finance_private.pin_sessions where user_id = auth.uid();
  if p_new_pin is null then
    delete from finance_private.account_pins where user_id = auth.uid();
  else
    insert into finance_private.account_pins(user_id, pin_hash) values(auth.uid(), crypt(p_new_pin, gen_salt('bf', 10)))
      on conflict(user_id) do update set pin_hash = excluded.pin_hash, failures = 0, locked_until = null;
    insert into finance_private.pin_sessions values(auth.uid(), sid);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- my_role được dùng bởi RLS và các RPC quản lý hộ hiện có.
create or replace function public.my_role(h uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from public.household_members
    where household_id = h and user_id = auth.uid() and public.pin_access()
$$;
drop policy if exists mem_select on public.household_members;
create policy mem_select on public.household_members for select to authenticated
  using (public.pin_access() and (user_id = auth.uid() or public.my_role(household_id) = 'owner'));

create or replace function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if not public.pin_access() then raise exception 'Cần mở khoá PIN'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Nhập tên trang'; end if;
  insert into public.households(name) values(left(trim(p_name),60)) returning id into h;
  insert into public.household_members values(h,auth.uid(),'owner');
  insert into public.finance_data(household_id) values(h);
  return h;
end $$;
create or replace function public.remove_member(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pin_access() then raise exception 'Cần mở khoá PIN'; end if;
  if p_user <> auth.uid() and public.my_role(p_household) is distinct from 'owner' then
    raise exception 'Chỉ chủ trang mới xoá được thành viên';
  end if;
  if (select role from public.household_members where household_id=p_household and user_id=p_user) = 'owner'
    and (select count(*) from public.household_members where household_id=p_household and role='owner') <= 1 then
    raise exception 'Trang phải còn ít nhất một chủ trang';
  end if;
  delete from public.household_members where household_id=p_household and user_id=p_user;
end $$;

alter table public.finance_data add column if not exists revision bigint not null default 0;
create table if not exists public.investment_history (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households on delete cascade,
  asset_id text not null,
  actor_id uuid,
  actor_name text not null,
  actor_email text,
  occurred_at timestamptz not null default now(),
  action text not null,
  before_data jsonb,
  after_data jsonb,
  restored_from bigint
);
create index if not exists investment_history_lookup on public.investment_history(household_id, asset_id, id desc);
alter table public.investment_history enable row level security;
drop policy if exists history_read on public.investment_history;
create policy history_read on public.investment_history for select to authenticated
  using(public.my_role(household_id) is not null);
revoke all on public.investment_history from public, anon, authenticated;
grant select on public.investment_history to authenticated;

create or replace function finance_private.asset_snapshot(d jsonb, aid text) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('asset', (select a from jsonb_array_elements(coalesce(d->'assets', '[]')) a where a->>'id' = aid),
    'trades', coalesce((select jsonb_agg(t order by ord) from jsonb_array_elements(coalesce(d->'itx','[]')) with ordinality as e(t,ord) where t->>'asset' = aid), '[]'))
$$;

create or replace function finance_private.track_investments() returns trigger
language plpgsql security definer set search_path = public as $$
declare aid text; b jsonb; a jsonb; who text; email_address text; source_id bigint;
begin
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  select coalesce(nullif(raw_user_meta_data->>'name',''), email, id::text), email into who, email_address from auth.users where id = auth.uid();
  source_id := nullif(current_setting('finance.restore_source', true), '')::bigint;
  for aid in select distinct x->>'id' from (
    select jsonb_array_elements(coalesce(old.data->'assets','[]')) x
    union all select jsonb_array_elements(coalesce(new.data->'assets','[]')) x
  ) s
  loop
    b := finance_private.asset_snapshot(old.data, aid);
    a := finance_private.asset_snapshot(new.data, aid);
    -- Giá thị trường tự cập nhật không tạo phiên bản giao dịch.
    if (b #- '{asset,price}' #- '{asset,priceAt}') is distinct from (a #- '{asset,price}' #- '{asset,priceAt}')
      or exists(select 1 from public.investment_history where id=source_id and asset_id=aid) then
      insert into public.investment_history(household_id, asset_id, actor_id, actor_name, actor_email, action, before_data, after_data, restored_from)
      values(new.household_id, aid, auth.uid(), coalesce(who,'Hệ thống'), email_address,
        case when source_id is not null then 'restore' else 'change' end, b, a, source_id);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists investment_versions on public.finance_data;
create trigger investment_versions before update on public.finance_data
  for each row execute function finance_private.track_investments();

-- Mốc ban đầu: không gán người tạo cho những giao dịch đã có trước bản cập nhật.
insert into public.investment_history(household_id, asset_id, actor_name, action, after_data)
select f.household_id, a->>'id', 'Chưa ghi nhận (dữ liệu cũ)', 'baseline', finance_private.asset_snapshot(f.data, a->>'id')
from public.finance_data f cross join lateral jsonb_array_elements(coalesce(f.data->'assets','[]')) a
where not exists(select 1 from public.investment_history h where h.household_id=f.household_id and h.asset_id=a->>'id');

-- Chỉ khôi phục một mã, không thay đổi thu chi hoặc các mã khác.
create or replace function public.restore_investment(p_household uuid, p_history bigint, p_side text, p_revision bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare f public.finance_data; h public.investment_history; snap jsonb; d jsonb; assets jsonb; trades jsonb;
  a jsonb; t jsonb; own text; k text; positions jsonb := '{}'; q numeric; qty numeric;
begin
  if public.my_role(p_household) is null or public.my_role(p_household) not in ('owner','editor') then raise exception 'Không có quyền khôi phục'; end if;
  select * into f from public.finance_data where household_id=p_household for update;
  if f.revision is distinct from p_revision then raise exception 'Dữ liệu đã thay đổi. Tải lại trước khi khôi phục.'; end if;
  select * into h from public.investment_history where id=p_history and household_id=p_household;
  if not found or p_side not in ('before','after') or p_side is null then raise exception 'Phiên bản không hợp lệ'; end if;
  snap := case p_side when 'before' then h.before_data else h.after_data end;
  if snap is null then raise exception 'Không có phiên bản này'; end if;
  a := snap->'asset';
  select coalesce(jsonb_agg(x),'[]') into assets from jsonb_array_elements(coalesce(f.data->'assets','[]')) x where x->>'id' <> h.asset_id;
  if a <> 'null'::jsonb then
    if exists(select 1 from jsonb_array_elements(assets) x where x->>'sym'=a->>'sym') then raise exception 'Mã trùng với tài sản khác. Hãy đổi mã trước khi khôi phục.'; end if;
    -- Giữ giá thị trường mới nhất khi mã vẫn tồn tại.
    select x into t from jsonb_array_elements(coalesce(f.data->'assets','[]')) x where x->>'id'=h.asset_id;
    if t is not null then a := a || jsonb_build_object('price',t->'price','priceAt',t->'priceAt'); end if;
    assets := assets || jsonb_build_array(a);
  end if;
  select coalesce(jsonb_agg(x),'[]') into trades from jsonb_array_elements(coalesce(f.data->'itx','[]')) x where x->>'asset' <> h.asset_id;
  trades := trades || coalesce(snap->'trades','[]');
  if exists(select 1 from jsonb_array_elements(trades) x group by x->>'id' having count(*)>1) then raise exception 'Trùng mã giao dịch, không thể khôi phục'; end if;
  for t in select x from jsonb_array_elements(coalesce(snap->'trades','[]')) with ordinality as e(x,ord) order by x->>'date', coalesce(x->>'at',''), ord
  loop
    own := coalesce(nullif(t->>'owner',''), a->>'owner', 'Chung'); k := own;
    q := coalesce((positions->>k)::numeric,0); qty := (t->>'qty')::numeric;
    if t->>'type' in ('buy','sdiv') then q := q + qty;
    elsif t->>'type' = 'sell' then
      if qty > q + 0.000000001 then raise exception 'Phiên bản có giao dịch bán vượt số lượng nắm giữ'; end if;
      q := greatest(0,q-qty);
    end if;
    positions := jsonb_set(positions,array[k],to_jsonb(q));
  end loop;
  d := jsonb_set(jsonb_set(f.data,'{assets}',assets),'{itx}',trades);
  perform set_config('finance.restore_source',h.id::text,true);
  update public.finance_data set data=d, client=null where household_id=p_household returning revision into p_revision;
  return p_revision;
end $$;

create or replace function public.archived_investments(p_household uuid)
returns table(asset_id text, symbol text)
language sql stable security definer set search_path = public as $$
  select distinct on (h.asset_id) h.asset_id,
    coalesce(h.after_data->'asset'->>'sym', h.before_data->'asset'->>'sym', h.asset_id)
  from public.investment_history h
  where h.household_id=p_household and public.my_role(p_household) is not null
    and not exists(select 1 from public.finance_data f, jsonb_array_elements(coalesce(f.data->'assets','[]')) a
      where f.household_id=p_household and a->>'id'=h.asset_id)
  order by h.asset_id, h.id desc
$$;

revoke all on all functions in schema finance_private from public, anon, authenticated;
revoke all on function public.pin_access(), public.pin_status(), public.pin_unlock(text), public.pin_configure(text,text), public.restore_investment(uuid,bigint,text,bigint), public.archived_investments(uuid) from public, anon;
grant execute on function public.pin_access(), public.pin_status(), public.pin_unlock(text), public.pin_configure(text,text), public.restore_investment(uuid,bigint,text,bigint), public.archived_investments(uuid) to authenticated;
commit;
