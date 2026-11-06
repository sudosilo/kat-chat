-- Rooms, part one: room tables and the functions the app calls.
-- Part two (access rules on messages, reactions, names, files and games) is added after the layout snapshot.
create extension if not exists pgcrypto;

create table if not exists chat_rooms (
  id text primary key,
  name text not null check (char_length(name) between 1 and 40),
  owner uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists chat_room_members (
  room text not null references chat_rooms(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  invited_by uuid,
  primary key (room, user_id)
);
create index if not exists chat_room_members_user on chat_room_members (user_id);
create table if not exists chat_room_keys (
  id bigint generated always as identity primary key,
  room text not null references chat_rooms(id) on delete cascade,
  code_hash text not null unique,
  code_hint text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  max_uses int not null default 1 check (max_uses between 1 and 100),
  uses int not null default 0,
  expires_at timestamptz,
  revoked boolean not null default false
);
alter table chat_rooms enable row level security;
alter table chat_room_members enable row level security;
alter table chat_room_keys enable row level security;
-- No direct table access. Everything goes through the functions below.

create or replace function room_role(p_room text) returns text
language sql stable security definer set search_path = public as $$
  select role from chat_room_members where room = p_room and user_id = auth.uid()
$$;
create or replace function room_joined(p_room text) returns timestamptz
language sql stable security definer set search_path = public as $$
  select joined_at from chat_room_members where room = p_room and user_id = auth.uid()
$$;
-- True when the signed in person shares any room with p_user, or is that person.
create or replace function shares_room(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from chat_room_members a join chat_room_members b on a.room = b.room
    where a.user_id = auth.uid() and b.user_id = p_user)
$$;

create or replace function my_rooms() returns table (id text, name text, owner uuid, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.owner, m.role, m.joined_at
  from chat_room_members m join chat_rooms r on r.id = m.room
  where m.user_id = auth.uid()
  order by m.joined_at
$$;

create or replace function room_members(p_room text)
returns table (user_id uuid, role text, joined_at timestamptz, invited_by uuid, message_count bigint, file_count bigint, reaction_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if room_role(p_room) is null then raise exception 'not in this room'; end if;
  return query
    select m.user_id, m.role, m.joined_at, m.invited_by,
      (select count(*) from chat_messages c where c.room = p_room and c.sender = m.user_id and c.deleted_at is null),
      (select count(*) from chat_messages c where c.room = p_room and c.sender = m.user_id and c.deleted_at is null and c.file_path is not null),
      (select count(*) from chat_reactions x join chat_messages c on c.id = x.message_id where c.room = p_room and x.user_id = m.user_id)
    from chat_room_members m where m.room = p_room
    order by m.joined_at;
end $$;

create or replace function room_create(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  if auth.uid() is null or not exists (select 1 from chat_members where user_id = auth.uid()) then raise exception 'only main chat members can create rooms'; end if;
  if (select count(*) from chat_rooms where owner = auth.uid()) >= 20 then raise exception 'room limit reached'; end if;
  rid := 'r-' || encode(gen_random_bytes(5), 'hex');
  insert into chat_rooms (id, name, owner) values (rid, trim(p_name), auth.uid());
  insert into chat_room_members (room, user_id, role) values (rid, auth.uid(), 'owner');
  return rid;
end $$;

create or replace function room_key_new(p_room text, p_max_uses int, p_days int) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if room_role(p_room) is distinct from 'owner' then raise exception 'only the room owner can make keys'; end if;
  code := 'rk-' || encode(gen_random_bytes(6), 'hex');
  insert into chat_room_keys (room, code_hash, code_hint, created_by, max_uses, expires_at)
  values (p_room, encode(digest(code, 'sha256'), 'hex'), substr(code, 4, 4), auth.uid(),
          greatest(1, least(coalesce(p_max_uses, 1), 100)), now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 365))));
  return code;
end $$;

create or replace function room_keys(p_room text)
returns table (id bigint, code_hint text, created_at timestamptz, max_uses int, uses int, expires_at timestamptz, revoked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if room_role(p_room) is distinct from 'owner' then raise exception 'only the room owner can see keys'; end if;
  return query select k.id, k.code_hint, k.created_at, k.max_uses, k.uses, k.expires_at, k.revoked
    from chat_room_keys k where k.room = p_room order by k.created_at desc limit 100;
end $$;

create or replace function room_key_revoke(p_key bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select room into r from chat_room_keys where id = p_key;
  if r is null or room_role(r) is distinct from 'owner' then raise exception 'not allowed'; end if;
  update chat_room_keys set revoked = true where id = p_key;
  return true;
end $$;

create or replace function room_join(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare k chat_room_keys;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into k from chat_room_keys where code_hash = encode(digest(lower(trim(p_code)), 'sha256'), 'hex') for update;
  if not found or k.revoked or k.uses >= k.max_uses or (k.expires_at is not null and k.expires_at < now()) then return null; end if;
  if exists (select 1 from chat_room_members where room = k.room and user_id = auth.uid()) then return k.room; end if;
  insert into chat_room_members (room, user_id, role, invited_by) values (k.room, auth.uid(), 'member', k.created_by);
  update chat_room_keys set uses = uses + 1 where id = k.id;
  return k.room;
end $$;

create or replace function room_remove(p_room text, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if room_role(p_room) is distinct from 'owner' or p_user = auth.uid() then raise exception 'not allowed'; end if;
  delete from chat_room_members where room = p_room and user_id = p_user;
  return true;
end $$;

create or replace function room_leave(p_room text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if room_role(p_room) is distinct from 'member' then raise exception 'owners delete the room instead'; end if;
  delete from chat_room_members where room = p_room and user_id = auth.uid();
  return true;
end $$;

create or replace function room_delete(p_room text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if room_role(p_room) is distinct from 'owner' then raise exception 'only the room owner can delete it'; end if;
  delete from chat_reactions where message_id in (select id from chat_messages where room = p_room);
  delete from chat_push_log where message_id in (select id from chat_messages where room = p_room);
  delete from chat_messages where room = p_room;
  delete from chat_rooms where id = p_room;
  return true;
end $$;

revoke execute on function room_role(text), room_joined(text), shares_room(uuid), my_rooms(), room_members(text), room_create(text),
  room_key_new(text, int, int), room_keys(text), room_key_revoke(bigint), room_join(text), room_remove(text, uuid), room_leave(text), room_delete(text) from anon, public;
grant execute on function room_role(text), room_joined(text), shares_room(uuid), my_rooms(), room_members(text), room_create(text),
  room_key_new(text, int, int), room_keys(text), room_key_revoke(bigint), room_join(text), room_remove(text, uuid), room_leave(text), room_delete(text) to authenticated;
