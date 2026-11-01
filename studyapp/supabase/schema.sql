-- StudyVerse: esquema do banco (cole no SQL Editor do Supabase e execute)
create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Estudante',
  avatar_url text,
  accent text not null default '#7c5cff',
  theme text not null default 'dark' check (theme in ('dark','light')),
  xp integer not null default 0 check (xp >= 0),
  notif_prefs jsonb not null default '{"atividades":true,"metas":true,"conquistas":true,"revisoes":true,"resumo":true}',
  available_hours jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, color text not null default '#7c5cff', icon text not null default 'book',
  position integer not null default 0, created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  parent_id uuid references public.topics(id) on delete cascade,
  title text not null, notes text,
  status text not null default 'not_started' check (status in ('not_started','in_progress','done')),
  mastery smallint check (mastery between 1 and 5),
  studied_on date, minutes_spent integer not null default 0,
  completed_at timestamptz, created_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null, description text,
  kind text not null default 'study' check (kind in ('study','exercise','review')),
  scheduled_for date not null, start_time time, est_minutes integer,
  done boolean not null default false, done_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  done_on date not null default current_date,
  total integer not null check (total > 0),
  correct integer not null default 0 check (correct >= 0),
  wrong integer not null default 0 check (wrong >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  source text, notes text, created_at timestamptz not null default now(),
  check (correct + wrong + skipped = total)
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  started_at timestamptz not null, seconds integer not null check (seconds > 0),
  mode text not null default 'free' check (mode in ('free','pomodoro')),
  created_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  period text not null check (period in ('daily','weekly','monthly')),
  metric text not null check (metric in ('topics','questions','minutes')),
  target integer not null check (target > 0),
  valid_from date not null default current_date, valid_to date,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  due_on date not null, interval_days integer not null default 1,
  done_at timestamptz, mastery_after smallint check (mastery_after between 1 and 5),
  created_at timestamptz not null default now()
);

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null, amount integer not null check (amount > 0),
  ref_id uuid, created_at timestamptz not null default now(),
  unique (user_id, reason, ref_id) -- impede XP duplicado pela mesma ação
);

create table public.achievements_unlocked (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null, unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null, message text not null, read boolean not null default false,
  created_at timestamptz not null default now()
);

create index on public.topics (user_id, subject_id);
create index on public.activities (user_id, scheduled_for);
create index on public.exercises (user_id, done_on);
create index on public.study_sessions (user_id, started_at);
create index on public.reviews (user_id, due_on);

-- Row Level Security: cada pessoa acessa somente as próprias linhas
do $$
declare t text;
begin
  foreach t in array array['subjects','topics','activities','exercises','study_sessions','goals','reviews','xp_events','achievements_unlocked','notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy "ver proprio perfil" on public.profiles for select using (id = auth.uid());
create policy "editar proprio perfil" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Cria o perfil automaticamente no cadastro
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- XP somente por função (o cliente não altera o próprio XP diretamente)
revoke update (xp) on public.profiles from authenticated;
create or replace function public.award_xp(p_reason text, p_amount int, p_ref uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare total int;
begin
  if p_amount < 1 or p_amount > 100 then raise exception 'valor de XP inválido'; end if;
  insert into xp_events (user_id, reason, amount, ref_id) values (auth.uid(), p_reason, p_amount, p_ref)
    on conflict do nothing;
  if found then update profiles set xp = xp + p_amount where id = auth.uid(); end if;
  select xp into total from profiles where id = auth.uid();
  return total;
end $$;
grant execute on function public.award_xp(text,int,uuid) to authenticated;

-- Exclusão da própria conta e de todos os dados associados
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin delete from auth.users where id = auth.uid(); end $$;
grant execute on function public.delete_my_account() to authenticated;
