-- =====================================================================
-- StudyVerse: sistema social (amizades, presença, rankings, privacidade)
-- + endurecimento do XP, das conquistas e do tempo de estudo.
-- Onde rodar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pré-requisito: o schema.sql original já executado. Pode rodar mais de uma vez.
-- Não apaga nem recria tabelas existentes.
-- =====================================================================

-- 1) PERFIS: nome de usuário e fuso horário --------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists tz text not null default 'UTC';

update public.profiles p
set username = left(coalesce(nullif(regexp_replace(lower(split_part(coalesce((select u.email from auth.users u where u.id = p.id), ''), '@', 1)), '[^a-z0-9_]', '', 'g'), ''), 'user'), 12) || substr(md5(p.id::text), 1, 4)
where p.username is null;

alter table public.profiles alter column username set not null;
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$');
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- O cliente só pode editar campos pessoais (nunca o XP).
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, accent, theme, notif_prefs, available_hours, username, tz) on public.profiles to authenticated;

-- 2) PRIVACIDADE ---------------------------------------------------------------
create table if not exists public.privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  searchable boolean not null default true,      -- aparecer na busca
  show_status boolean not null default true,     -- mostrar online/estudando
  share_stats boolean not null default true,     -- compartilhar tempo de estudo e metas
  show_progress boolean not null default true,   -- compartilhar XP, nível e conquistas
  updated_at timestamptz not null default now()
);
alter table public.privacy_settings enable row level security;
drop policy if exists "privacidade propria" on public.privacy_settings;
create policy "privacidade propria" on public.privacy_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
insert into public.privacy_settings (user_id) select id from public.profiles on conflict do nothing;

-- Novo cadastro: perfil + username + privacidade.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text;
begin
  base := coalesce(nullif(left(regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '', 'g'), 12), ''), 'user');
  insert into public.profiles (id, display_name, username)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)), base || substr(md5(new.id::text), 1, 4));
  insert into public.privacy_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- 3) AMIZADES E BLOQUEIOS (somente via funções) -------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
-- Um único vínculo por par de pessoas, em qualquer direção (impede duplicatas).
create unique index if not exists friendships_pair_key on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);
alter table public.friendships enable row level security;
drop policy if exists "ver minhas amizades" on public.friendships;
create policy "ver minhas amizades" on public.friendships for select using (auth.uid() in (requester_id, addressee_id));
revoke insert, update, delete on public.friendships from authenticated;

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
drop policy if exists "ver meus bloqueios" on public.blocks;
create policy "ver meus bloqueios" on public.blocks for select using (blocker_id = auth.uid());
revoke insert, update, delete on public.blocks from authenticated;

-- 4) FUNÇÕES AUXILIARES (não expostas ao cliente) -------------------------------
create or replace function public.safe_tz(p text) returns text
language sql stable set search_path = public, pg_catalog as $$
  select coalesce((select name from pg_timezone_names where name = p limit 1), 'UTC') $$;

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where status = 'accepted' and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))) $$;

create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)) $$;

create or replace function public.measure_sql(p_uid uuid, p_tz text, p_metric text, p_a date, p_b date, p_subject uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'topics' then (select count(*)::int from topics t where t.user_id = p_uid and t.status = 'done' and t.completed_at is not null
        and (t.completed_at at time zone p_tz)::date between p_a and p_b and (p_subject is null or t.subject_id = p_subject))
    when 'questions' then (select coalesce(sum(e.total), 0)::int from exercises e where e.user_id = p_uid and e.done_on between p_a and p_b
        and (p_subject is null or e.subject_id = p_subject))
    when 'sessions' then (select count(*)::int from study_sessions s where s.user_id = p_uid
        and (s.started_at at time zone p_tz)::date between p_a and p_b and (p_subject is null or s.subject_id = p_subject))
    when 'reviews' then (select count(*)::int from reviews r where r.user_id = p_uid and r.done_at is not null
        and (r.done_at at time zone p_tz)::date between p_a and p_b)
    when 'minutes' then (select coalesce(round(sum(s.seconds) / 60.0), 0)::int from study_sessions s where s.user_id = p_uid
        and (s.started_at at time zone p_tz)::date between p_a and p_b and (p_subject is null or s.subject_id = p_subject))
    else 0 end $$;

revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.measure_sql(uuid, text, text, date, date, uuid) from public, anon, authenticated;

-- 5) PRESENÇA ------------------------------------------------------------------------------
create table if not exists public.presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now(),
  studying boolean not null default false
);
alter table public.presence enable row level security;

-- Só o próprio usuário ou amigo aceito (que não esteja bloqueado e cujo dono mostre o status).
create or replace function public.can_see_status(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid() or (
    public.are_friends(auth.uid(), p_owner)
    and not public.is_blocked(auth.uid(), p_owner)
    and coalesce((select ps.show_status from privacy_settings ps where ps.user_id = p_owner), true)) $$;
grant execute on function public.can_see_status(uuid) to authenticated;

drop policy if exists "ver presenca" on public.presence;
create policy "ver presenca" on public.presence for select using (public.can_see_status(user_id));
revoke insert, update, delete on public.presence from authenticated;

create or replace function public.heartbeat(p_studying boolean default false) returns void
language sql security definer set search_path = public as $$
  insert into presence (user_id, last_seen, studying) values (auth.uid(), now(), coalesce(p_studying, false))
  on conflict (user_id) do update set last_seen = now(), studying = coalesce(p_studying, false) $$;

create or replace function public.go_offline() returns void
language sql security definer set search_path = public as $$
  update presence set studying = false, last_seen = now() - interval '1 hour' where user_id = auth.uid() $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'presence') then
    alter publication supabase_realtime add table public.presence;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    alter publication supabase_realtime add table public.friendships;
  end if;
end $$;

-- 6) SESSÕES DE ESTUDO CRONOMETRADAS PELO SERVIDOR --------------------------------
-- O tempo registrado nunca passa do tempo real decorrido desde o início da sessão.
create table if not exists public.study_active (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  subject_id uuid references public.subjects(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  mode text not null default 'free' check (mode in ('free', 'pomodoro'))
);
alter table public.study_active enable row level security;   -- sem políticas: só as funções acessam

create or replace function public.start_study_session(p_subject uuid, p_topic uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sessão expirada.'; end if;
  if p_mode not in ('free', 'pomodoro') then raise exception 'Modo inválido.'; end if;
  if p_subject is not null and not exists (select 1 from subjects where id = p_subject and user_id = auth.uid()) then raise exception 'Matéria inválida.'; end if;
  if p_topic is not null and not exists (select 1 from topics where id = p_topic and user_id = auth.uid()) then raise exception 'Conteúdo inválido.'; end if;
  insert into study_active (user_id, started_at, subject_id, topic_id, mode) values (auth.uid(), now(), p_subject, p_topic, p_mode)
  on conflict (user_id) do update set started_at = now(), subject_id = excluded.subject_id, topic_id = excluded.topic_id, mode = excluded.mode;
end $$;

create or replace function public.finish_study_session(p_seconds integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare a study_active%rowtype; secs integer; sid uuid;
begin
  select * into a from study_active where user_id = auth.uid();
  if not found then raise exception 'Nenhuma sessão em andamento.'; end if;
  delete from study_active where user_id = auth.uid();
  secs := least(greatest(coalesce(p_seconds, 0), 0), floor(extract(epoch from (now() - a.started_at)))::int, 43200);
  if secs < 60 then return null; end if;
  insert into study_sessions (user_id, subject_id, topic_id, started_at, seconds, mode)
  values (auth.uid(), a.subject_id, a.topic_id, a.started_at, secs, a.mode) returning id into sid;
  return sid;
end $$;

create or replace function public.cancel_study_session() returns void
language sql security definer set search_path = public as $$
  delete from study_active where user_id = auth.uid() $$;

revoke insert, update on public.study_sessions from authenticated;

-- 7) XP E CONQUISTAS SÓ POR VALIDAÇÃO NO SERVIDOR -----------------------------------
drop policy if exists "own rows" on public.xp_events;
drop policy if exists "ver meu xp" on public.xp_events;
create policy "ver meu xp" on public.xp_events for select using (user_id = auth.uid());
revoke insert, update, delete on public.xp_events from authenticated;

drop policy if exists "own rows" on public.achievements_unlocked;
drop policy if exists "ver minhas conquistas" on public.achievements_unlocked;
create policy "ver minhas conquistas" on public.achievements_unlocked for select using (user_id = auth.uid());
revoke insert, update, delete on public.achievements_unlocked from authenticated;

-- Mesma função e mesma assinatura de antes; agora cada concessão é conferida nos registros reais.
create or replace function public.award_xp(p_reason text, p_amount integer, p_ref uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_tz text; v_today date; v_kind text; v_fixed integer; v_cap integer; v_n integer; v_done integer; v_total integer;
  v_goal goals%rowtype; v_a date; v_b date; v_code text; v_metric text; v_target integer; v_period text;
begin
  if v_uid is null then raise exception 'xp_rejected: sem login'; end if;
  select public.safe_tz(p.tz) into v_tz from profiles p where p.id = v_uid;
  v_today := (now() at time zone v_tz)::date;
  v_kind := split_part(p_reason, ':', 1);

  if v_kind = 'topic' then
    if not exists (select 1 from topics where id = p_ref and user_id = v_uid and status = 'done') then raise exception 'xp_rejected: conteúdo'; end if;
    v_fixed := 20; v_cap := 5;
  elsif v_kind = 'exercise' then
    if not exists (select 1 from exercises where id = p_ref and user_id = v_uid) then raise exception 'xp_rejected: exercício'; end if;
    v_fixed := 10; v_cap := 3;
  elsif v_kind = 'session' then
    if not exists (select 1 from study_sessions where id = p_ref and user_id = v_uid and seconds >= 300) then raise exception 'xp_rejected: sessão'; end if;
    v_fixed := 10; v_cap := 5;
  elsif v_kind = 'review' then
    if not exists (select 1 from reviews where id = p_ref and user_id = v_uid and done_at is not null) then raise exception 'xp_rejected: revisão'; end if;
    v_fixed := 10; v_cap := 5;
  elsif v_kind = 'activity' then
    if not exists (select 1 from activities where id = p_ref and user_id = v_uid and done) then raise exception 'xp_rejected: atividade'; end if;
    v_fixed := 5; v_cap := 6;
  elsif v_kind in ('goal_daily', 'goal_weekly', 'goal_monthly') then
    select * into v_goal from goals where id = p_ref and user_id = v_uid;
    if not found or v_goal.period <> substr(v_kind, 6) then raise exception 'xp_rejected: meta'; end if;
    v_a := split_part(p_reason, ':', 2)::date;
    if v_kind = 'goal_daily' then v_b := v_a; v_fixed := 15;
    elsif v_kind = 'goal_weekly' then
      if extract(isodow from v_a) <> 1 then raise exception 'xp_rejected: semana'; end if;
      v_b := v_a + 6; v_fixed := 30;
    else
      if extract(day from v_a) <> 1 then raise exception 'xp_rejected: mês'; end if;
      v_b := (date_trunc('month', v_a::timestamp) + interval '1 month - 1 day')::date; v_fixed := 50;
    end if;
    if v_a > v_today or v_b < v_goal.valid_from or (v_goal.valid_to is not null and v_a > v_goal.valid_to) then raise exception 'xp_rejected: período'; end if;
    if public.measure_sql(v_uid, v_tz, v_goal.metric, v_a, v_b, v_goal.subject_id) < v_goal.target then raise exception 'xp_rejected: meta não cumprida'; end if;
  elsif v_kind = 'week_plan' then
    if p_ref is distinct from v_uid then raise exception 'xp_rejected: ref'; end if;
    v_a := split_part(p_reason, ':', 2)::date;
    if extract(isodow from v_a) <> 1 or v_a > v_today then raise exception 'xp_rejected: semana'; end if;
    select count(*), count(*) filter (where done) into v_n, v_done from activities where user_id = v_uid and scheduled_for between v_a and v_a + 6;
    if v_n < 3 or v_n <> v_done then raise exception 'xp_rejected: planejamento'; end if;
    v_fixed := 25;
  elsif v_kind = 'mission' then
    if p_ref is distinct from v_uid then raise exception 'xp_rejected: ref'; end if;
    v_code := split_part(p_reason, ':', 2);
    v_a := split_part(p_reason, ':', 3)::date;
    select m.metric, m.target, m.xp, m.period into v_metric, v_target, v_fixed, v_period
    from (values ('d_topics2', 'topics', 2, 15, 'daily'), ('d_sessions3', 'sessions', 3, 15, 'daily'), ('d_q20', 'questions', 20, 15, 'daily'),
                 ('w_review1', 'reviews', 1, 20, 'weekly'), ('w_min120', 'minutes', 120, 25, 'weekly')) as m(code, metric, target, xp, period)
    where m.code = v_code;
    if v_metric is null or v_a > v_today then raise exception 'xp_rejected: missão'; end if;
    if v_period = 'daily' then v_b := v_a;
    else
      if extract(isodow from v_a) <> 1 then raise exception 'xp_rejected: semana'; end if;
      v_b := v_a + 6;
    end if;
    if public.measure_sql(v_uid, v_tz, v_metric, v_a, v_b, null) < v_target then raise exception 'xp_rejected: missão não cumprida'; end if;
  else
    raise exception 'xp_rejected: motivo desconhecido';
  end if;

  if p_amount is distinct from v_fixed then raise exception 'xp_rejected: valor'; end if;

  if v_cap is not null then
    select count(*) into v_n from xp_events where user_id = v_uid and reason = p_reason and (created_at at time zone v_tz)::date = v_today;
    if v_n >= v_cap then
      select xp into v_total from profiles where id = v_uid;
      return v_total;
    end if;
  end if;

  insert into xp_events (user_id, reason, amount, ref_id) values (v_uid, p_reason, v_fixed, p_ref) on conflict do nothing;
  if found then update profiles set xp = xp + v_fixed where id = v_uid; end if;
  select xp into v_total from profiles where id = v_uid;
  return v_total;
end $$;
grant execute on function public.award_xp(text, integer, uuid) to authenticated;

create or replace function public.unlock_achievement(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_tz text; v_ok boolean := false; v_days bigint; v_best bigint;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  select public.safe_tz(p.tz) into v_tz from profiles p where p.id = v_uid;
  if p_code = 'first_step' then select count(*) >= 1 into v_ok from topics where user_id = v_uid and status = 'done';
  elsif p_code = 'good_start' then select count(*) >= 5 into v_ok from topics where user_id = v_uid and status = 'done';
  elsif p_code = 'knowledge' then select count(*) >= 50 into v_ok from topics where user_id = v_uid and status = 'done';
  elsif p_code = 'practitioner' then select count(*) >= 1 into v_ok from exercises where user_id = v_uid;
  elsif p_code = 'analytic' then select coalesce(sum(total), 0) >= 200 into v_ok from exercises where user_id = v_uid;
  elsif p_code = 'focus' then select coalesce(sum(seconds), 0) >= 36000 into v_ok from study_sessions where user_id = v_uid;
  elsif p_code = 'productive_week' then select exists (select 1 from xp_events where user_id = v_uid and starts_with(reason, 'goal_weekly:')) into v_ok;
  elsif p_code = 'organizer' then select exists (select 1 from xp_events where user_id = v_uid and starts_with(reason, 'week_plan:')) into v_ok;
  elsif p_code in ('persistence', 'streak7') then
    with days as (
      select distinct d from (
        select (started_at at time zone v_tz)::date as d from study_sessions where user_id = v_uid
        union all select done_on from exercises where user_id = v_uid
        union all select (completed_at at time zone v_tz)::date from topics where user_id = v_uid and completed_at is not null
        union all select (done_at at time zone v_tz)::date from activities where user_id = v_uid and done_at is not null
        union all select (done_at at time zone v_tz)::date from reviews where user_id = v_uid and done_at is not null) x),
    g1 as (select d, case when d - lag(d) over (order by d) > 2 then 1 else 0 end as brk from days),
    g as (select d, sum(brk) over (order by d) as grp from g1)
    select (select count(*) from days), coalesce((select max(c) from (select count(*) as c from g group by grp) z), 0) into v_days, v_best;
    v_ok := case when p_code = 'persistence' then v_days >= 5 else v_best >= 7 end;
  else raise exception 'Conquista desconhecida.';
  end if;
  if not coalesce(v_ok, false) then return false; end if;
  insert into achievements_unlocked (user_id, code) values (v_uid, p_code) on conflict do nothing;
  return found;
end $$;
grant execute on function public.unlock_achievement(text) to authenticated;

-- 8) FUNÇÕES SOCIAIS (todas respeitam amizade, bloqueio e privacidade) -------
create or replace function public.search_users(p_term text)
returns table (id uuid, friendship_id uuid, display_name text, username text, avatar_url text, relation text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_term text := ltrim(trim(coalesce(p_term, '')), '@'); v_pat text;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  if length(v_term) < 2 then return; end if;
  v_pat := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, f.id, p.display_name, p.username, p.avatar_url,
    case when f.id is null then 'none' when f.status = 'accepted' then 'friend' when f.requester_id = v_uid then 'sent' else 'received' end
  from profiles p
  join privacy_settings ps on ps.user_id = p.id
  left join friendships f on (f.requester_id = v_uid and f.addressee_id = p.id) or (f.addressee_id = v_uid and f.requester_id = p.id)
  where p.id <> v_uid and (ps.searchable or f.status = 'accepted')
    and not exists (select 1 from blocks b where (b.blocker_id = v_uid and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = v_uid))
    and (p.display_name ilike v_pat or p.username ilike v_pat)
  order by p.display_name limit 20;
end $$;

create or replace function public.send_friend_request(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  if p_target = v_uid then raise exception 'Você não pode adicionar a si mesmo.'; end if;
  if not exists (select 1 from profiles where id = p_target) then raise exception 'Usuário não encontrado.'; end if;
  if public.is_blocked(v_uid, p_target) then raise exception 'Não foi possível enviar a solicitação.'; end if;
  if exists (select 1 from friendships where (requester_id = v_uid and addressee_id = p_target) or (requester_id = p_target and addressee_id = v_uid)) then
    raise exception 'Já existe uma solicitação ou amizade com este usuário.';
  end if;
  insert into friendships (requester_id, addressee_id) values (v_uid, p_target);
end $$;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); f friendships%rowtype;
begin
  select * into f from friendships where id = p_id and addressee_id = v_uid and status = 'pending';
  if not found then raise exception 'Solicitação não encontrada.'; end if;
  if p_accept and not public.is_blocked(v_uid, f.requester_id) then
    update friendships set status = 'accepted', responded_at = now() where id = p_id;
  else
    delete from friendships where id = p_id;
  end if;
end $$;

-- Cancelar solicitação enviada, recusar ou desfazer amizade.
create or replace function public.remove_friendship(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from friendships where id = p_id and auth.uid() in (requester_id, addressee_id);
  if not found then raise exception 'Vínculo não encontrado.'; end if;
end $$;

create or replace function public.block_user(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  if p_target = v_uid then raise exception 'Você não pode bloquear a si mesmo.'; end if;
  if not exists (select 1 from profiles where id = p_target) then raise exception 'Usuário não encontrado.'; end if;
  delete from friendships where (requester_id = v_uid and addressee_id = p_target) or (requester_id = p_target and addressee_id = v_uid);
  insert into blocks (blocker_id, blocked_id) values (v_uid, p_target) on conflict do nothing;
end $$;

create or replace function public.unblock_user(p_target uuid) returns void
language sql security definer set search_path = public as $$
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_target $$;

create or replace function public.my_requests()
returns table (id uuid, direction text, other_id uuid, display_name text, username text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, case when f.requester_id = auth.uid() then 'sent' else 'received' end, p.id, p.display_name, p.username, p.avatar_url, f.created_at
  from friendships f
  join profiles p on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where f.status = 'pending' and auth.uid() in (f.requester_id, f.addressee_id)
  order by f.created_at desc $$;

create or replace function public.my_blocks()
returns table (id uuid, display_name text, username text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.username, p.avatar_url
  from blocks b join profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid() order by b.created_at desc $$;

-- Eu + amigos aceitos, com status, XP e tempos de estudo. Campos ocultos pela privacidade voltam nulos.
create or replace function public.friends_overview(p_tz text default null)
returns table (id uuid, friendship_id uuid, is_me boolean, display_name text, username text, avatar_url text,
  xp integer, weekly_xp integer, status text, last_seen timestamptz,
  today_s integer, week_s integer, month_s integer, total_s integer, sessions_count integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_tz text; v_today date; v_week date; v_month date;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  select public.safe_tz(coalesce(p_tz, me.tz)) into v_tz from profiles me where me.id = v_uid;
  v_today := (now() at time zone v_tz)::date;
  v_week := v_today - (extract(isodow from v_today)::int - 1);
  v_month := v_today - (extract(day from v_today)::int - 1);
  return query
  with ppl as (
    select v_uid as pid, null::uuid as fid, true as me
    union all
    select o.other, o.fid, false
    from (select case when f.requester_id = v_uid then f.addressee_id else f.requester_id end as other, f.id as fid
          from friendships f where f.status = 'accepted' and v_uid in (f.requester_id, f.addressee_id)) o
    where not exists (select 1 from blocks b where (b.blocker_id = v_uid and b.blocked_id = o.other) or (b.blocker_id = o.other and b.blocked_id = v_uid))
  )
  select p.id, ppl.fid, ppl.me, p.display_name, p.username, p.avatar_url,
    case when ppl.me or ps.show_progress then p.xp end,
    case when ppl.me or ps.show_progress then (select coalesce(sum(x.amount), 0)::int from xp_events x where x.user_id = p.id and (x.created_at at time zone v_tz)::date >= v_week) end,
    case when not (ppl.me or ps.show_status) then null
         when pr.last_seen is null or pr.last_seen < now() - interval '120 seconds' then 'offline'
         when pr.studying then 'studying' else 'online' end,
    case when ppl.me or ps.show_status then pr.last_seen end,
    case when ppl.me or ps.share_stats then st.t_s end,
    case when ppl.me or ps.share_stats then st.w_s end,
    case when ppl.me or ps.share_stats then st.m_s end,
    case when ppl.me or ps.share_stats then st.tot_s end,
    case when ppl.me or ps.share_stats then st.cnt end
  from ppl
  join profiles p on p.id = ppl.pid
  join privacy_settings ps on ps.user_id = p.id
  left join presence pr on pr.user_id = p.id
  left join lateral (
    select coalesce(sum(s.seconds) filter (where (s.started_at at time zone v_tz)::date = v_today), 0)::int as t_s,
           coalesce(sum(s.seconds) filter (where (s.started_at at time zone v_tz)::date >= v_week), 0)::int as w_s,
           coalesce(sum(s.seconds) filter (where (s.started_at at time zone v_tz)::date >= v_month), 0)::int as m_s,
           coalesce(sum(s.seconds), 0)::int as tot_s, count(*)::int as cnt
    from study_sessions s where s.user_id = p.id) st on true;
end $$;

-- Perfil de um amigo (completo) ou de um não amigo (apenas dados básicos, se pesquisável).
create or replace function public.friend_profile(p_id uuid, p_tz text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid(); v_tz text; v_today date; v_week date; v_month date; v_p profiles%rowtype; v_ps privacy_settings%rowtype;
  v_pr presence%rowtype; v_me boolean; v_fid uuid; v_status text; v_xp integer; v_stats jsonb; v_ach jsonb; v_goals jsonb;
begin
  if v_uid is null then raise exception 'Sessão expirada.'; end if;
  select public.safe_tz(coalesce(p_tz, me.tz)) into v_tz from profiles me where me.id = v_uid;
  v_today := (now() at time zone v_tz)::date;
  v_week := v_today - (extract(isodow from v_today)::int - 1);
  v_month := v_today - (extract(day from v_today)::int - 1);
  select * into v_p from profiles where id = p_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  v_me := (p_id = v_uid);
  if not v_me and public.is_blocked(v_uid, p_id) then raise exception 'Perfil indisponível.'; end if;
  select * into v_ps from privacy_settings where user_id = p_id;
  select f.id into v_fid from friendships f where f.status = 'accepted' and ((f.requester_id = v_uid and f.addressee_id = p_id) or (f.requester_id = p_id and f.addressee_id = v_uid));
  if not v_me and v_fid is null then
    if not (coalesce(v_ps.searchable, true) or exists (select 1 from friendships f where f.status = 'pending' and ((f.requester_id = v_uid and f.addressee_id = p_id) or (f.requester_id = p_id and f.addressee_id = v_uid)))) then
      raise exception 'Perfil indisponível.';
    end if;
    return jsonb_build_object('id', p_id, 'display_name', v_p.display_name, 'username', v_p.username, 'avatar_url', v_p.avatar_url, 'is_friend', false);
  end if;
  select * into v_pr from presence where user_id = p_id;
  v_status := case when not (v_me or coalesce(v_ps.show_status, true)) then null
                   when v_pr.last_seen is null or v_pr.last_seen < now() - interval '120 seconds' then 'offline'
                   when v_pr.studying then 'studying' else 'online' end;
  if v_me or coalesce(v_ps.share_stats, true) then
    select jsonb_build_object(
      'today_s', coalesce(sum(s.seconds) filter (where (s.started_at at time zone v_tz)::date = v_today), 0),
      'week_s', coalesce(sum(s.seconds) filter (where (s.started_at at time zone v_tz)::date >= v_week), 0),
      'month_s', coalesce(sum(s.seconds) filter (where (s.started_at at time zone v_tz)::date >= v_month), 0),
      'total_s', coalesce(sum(s.seconds), 0), 'sessions', count(*)) into v_stats
    from study_sessions s where s.user_id = p_id;
    select coalesce(jsonb_agg(jsonb_build_object('period', g.period, 'metric', g.metric, 'target', g.target,
             'value', public.measure_sql(p_id, v_tz, g.metric, w.a, w.b, g.subject_id))), '[]'::jsonb) into v_goals
    from goals g
    cross join lateral (select case g.period when 'daily' then v_today when 'weekly' then v_week else v_month end as a,
                               case g.period when 'daily' then v_today when 'weekly' then v_week + 6
                                    else (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date end as b) w
    where g.user_id = p_id and g.valid_from <= v_today and (g.valid_to is null or g.valid_to >= v_today);
  end if;
  if v_me or coalesce(v_ps.show_progress, true) then
    v_xp := v_p.xp;
    select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'unlocked_at', a.unlocked_at) order by a.unlocked_at desc), '[]'::jsonb) into v_ach
    from achievements_unlocked a where a.user_id = p_id;
  end if;
  return jsonb_build_object('id', p_id, 'display_name', v_p.display_name, 'username', v_p.username, 'avatar_url', v_p.avatar_url,
    'is_friend', true, 'is_me', v_me, 'friendship_id', v_fid, 'status', v_status, 'xp', v_xp, 'stats', v_stats, 'goals', v_goals, 'achievements', v_ach);
end $$;

-- 9) PERMISSÕES DAS FUNÇÕES CHAMADAS PELO APP -------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'heartbeat(boolean)', 'go_offline()', 'start_study_session(uuid,uuid,text)', 'finish_study_session(integer)', 'cancel_study_session()',
    'search_users(text)', 'send_friend_request(uuid)', 'respond_friend_request(uuid,boolean)', 'remove_friendship(uuid)', 'block_user(uuid)',
    'unblock_user(uuid)', 'my_requests()', 'my_blocks()', 'friends_overview(text)', 'friend_profile(uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
