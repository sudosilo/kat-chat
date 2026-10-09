create table if not exists chat_games (
  id bigint generated always as identity primary key,
  white uuid not null,
  black uuid not null,
  moves text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'checkmate', 'stalemate', 'draw', 'resigned')),
  winner uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (white <> black)
);
alter table chat_games enable row level security;
drop policy if exists "members see games" on chat_games;
create policy "members see games" on chat_games for select to authenticated using (public.my_join_time() is not null);

create or replace function chess_new(p_opponent uuid, p_white boolean) returns chat_games
language plpgsql security definer set search_path = public as $$
declare g chat_games;
begin
  if auth.uid() is null or public.my_join_time() is null then raise exception 'not a member'; end if;
  if p_opponent = auth.uid() or not exists (select 1 from chat_members where user_id = p_opponent) then raise exception 'bad opponent'; end if;
  insert into chat_games (white, black, created_by)
  values (case when p_white then auth.uid() else p_opponent end, case when p_white then p_opponent else auth.uid() end, auth.uid())
  returning * into g;
  return g;
end $$;

create or replace function chess_move(p_game bigint, p_move text, p_ply int, p_status text) returns chat_games
language plpgsql security definer set search_path = public as $$
declare g chat_games; n int;
begin
  select * into g from chat_games where id = p_game for update;
  if not found or g.status <> 'active' then raise exception 'game over'; end if;
  n := coalesce(array_length(g.moves, 1), 0);
  if n <> p_ply then raise exception 'out of sync'; end if;
  if (n % 2 = 0 and g.white <> auth.uid()) or (n % 2 = 1 and g.black <> auth.uid()) then raise exception 'not your turn'; end if;
  if p_move !~ '^[A-Za-z0-9+#=-]{2,8}$' then raise exception 'bad move'; end if;
  if p_status not in ('active', 'checkmate', 'stalemate', 'draw') then raise exception 'bad status'; end if;
  update chat_games set moves = moves || p_move, status = p_status,
    winner = case when p_status = 'checkmate' then auth.uid() else null end, updated_at = now()
  where id = p_game returning * into g;
  return g;
end $$;

create or replace function chess_resign(p_game bigint) returns chat_games
language plpgsql security definer set search_path = public as $$
declare g chat_games;
begin
  select * into g from chat_games where id = p_game for update;
  if not found or g.status <> 'active' then raise exception 'game over'; end if;
  if auth.uid() not in (g.white, g.black) then raise exception 'not a player'; end if;
  update chat_games set status = 'resigned', winner = case when auth.uid() = g.white then g.black else g.white end, updated_at = now()
  where id = p_game returning * into g;
  return g;
end $$;

revoke execute on function chess_new(uuid, boolean), chess_move(bigint, text, int, text), chess_resign(bigint) from anon, public;
grant execute on function chess_new(uuid, boolean), chess_move(bigint, text, int, text), chess_resign(bigint) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_games') then
    alter publication supabase_realtime add table chat_games;
  end if;
end $$;
