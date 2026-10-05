-- Cập nhật database cho bản 0.0.9 (chạy MỘT lần)
-- Supabase > SQL Editor > New query > chọn Database > dán toàn bộ file này > Run
-- Đã gồm toàn bộ nội dung bản 0.0.6. Không xoá hay sửa dữ liệu cũ, chạy lại nhiều lần cũng không sao.
-- 1. Danh sách thành viên của một trang (email, tên, avatar, quyền)
create or replace function public.list_members(p_household uuid)
returns table(user_id uuid, email text, name text, avatar text, role text)
language sql security definer stable set search_path = public as $$
  select m.user_id, u.email::text,
         coalesce(u.raw_user_meta_data->>'name', ''),
         coalesce(u.raw_user_meta_data->>'avatar', ''),
         m.role
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id = p_household
    and public.my_role(p_household) is not null
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, u.email
$$;

-- 2. Xoá thành viên (chủ trang xoá người khác, hoặc tự rời trang)
create or replace function public.remove_member(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  if p_user <> auth.uid() and public.my_role(p_household) is distinct from 'owner' then
    raise exception 'Chỉ chủ trang mới xoá được thành viên';
  end if;
  if (select role from public.household_members where household_id = p_household and user_id = p_user) = 'owner'
     and (select count(*) from public.household_members where household_id = p_household and role = 'owner') <= 1 then
    raise exception 'Trang phải còn ít nhất một chủ trang';
  end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
end $$;

-- 3. Đổi tên trang (chỉ chủ trang)
create or replace function public.rename_household(p_household uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_household) is distinct from 'owner' then raise exception 'Chỉ chủ trang mới đổi được tên'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Tên trang không được để trống'; end if;
  update public.households set name = left(trim(p_name), 60) where id = p_household;
end $$;

-- 4. Thêm thành viên / đổi quyền: thêm kiểm tra không để trang mất chủ cuối cùng
create or replace function public.add_member_by_email(p_household uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if public.my_role(p_household) is distinct from 'owner' then raise exception 'Chỉ chủ trang mới thêm được thành viên'; end if;
  if p_role not in ('owner','editor','viewer') then raise exception 'Quyền không hợp lệ'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'Người này chưa tạo tài khoản'; end if;
  if p_role <> 'owner'
     and (select role from public.household_members where household_id = p_household and user_id = u) = 'owner'
     and (select count(*) from public.household_members where household_id = p_household and role = 'owner') <= 1 then
    raise exception 'Trang phải còn ít nhất một chủ trang';
  end if;
  insert into public.household_members values (p_household, u, p_role)
  on conflict (household_id, user_id) do update set role = excluded.role;
end $$;

revoke execute on function public.list_members(uuid), public.remove_member(uuid,uuid), public.rename_household(uuid,text), public.add_member_by_email(uuid,text,text) from public, anon;
grant execute on function public.list_members(uuid), public.remove_member(uuid,uuid), public.rename_household(uuid,text), public.add_member_by_email(uuid,text,text) to authenticated;

-- 5. Xoá trang quản lý (chỉ chủ trang). Xoá kèm thành viên và dữ liệu của trang đó.
create or replace function public.delete_household(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_household) is distinct from 'owner' then raise exception 'Chỉ chủ trang mới xoá được trang'; end if;
  delete from public.households where id = p_household;
end $$;

revoke execute on function public.delete_household(uuid) from public, anon;
grant execute on function public.delete_household(uuid) to authenticated;