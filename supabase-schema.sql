-- Supabase Dashboard > SQL Editor에서 한 번만 실행하세요.
create extension if not exists pgcrypto;

create table if not exists public.team_members (
  email text primary key check (email = lower(email)),
  role text not null default 'member' check (role in ('admin','member')),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now()
);

insert into public.team_members (email, role)
values ('minkijon65@gmail.com', 'admin')
on conflict (email) do update set role = 'admin';

create table if not exists public.survey_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_email text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  category text not null check (category in ('보행','주차','안전','환경','편의시설','빈집·유휴공간','기타')),
  memo text not null check (char_length(memo) between 1 and 1000),
  image_paths text[] not null default '{}',
  surveyed_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.team_members where email = lower(auth.jwt()->>'email')) $$;

create or replace function public.is_team_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.team_members where email = lower(auth.jwt()->>'email') and role = 'admin') $$;

revoke all on function public.is_team_member() from public;
revoke all on function public.is_team_admin() from public;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.is_team_admin() to authenticated;

alter table public.team_members enable row level security;
alter table public.survey_records enable row level security;

create policy "members read own profile and admins read all" on public.team_members
for select to authenticated using (email = lower(auth.jwt()->>'email') or public.is_team_admin());
create policy "admins add members" on public.team_members
for insert to authenticated with check (public.is_team_admin());
create policy "admins remove non-admin members" on public.team_members
for delete to authenticated using (public.is_team_admin() and role <> 'admin');

create policy "team reads records" on public.survey_records
for select to authenticated using (public.is_team_member());
create policy "team creates own records" on public.survey_records
for insert to authenticated with check (public.is_team_member() and auth.uid() = user_id and author_email = lower(auth.jwt()->>'email'));
create policy "authors update records" on public.survey_records
for update to authenticated using (public.is_team_member() and (auth.uid() = user_id or public.is_team_admin()))
with check (public.is_team_member() and (auth.uid() = user_id or public.is_team_admin()));
create policy "authors delete records" on public.survey_records
for delete to authenticated using (public.is_team_member() and (auth.uid() = user_id or public.is_team_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('survey-photos','survey-photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=10485760;

create policy "team reads survey photos" on storage.objects
for select to authenticated using (bucket_id='survey-photos' and public.is_team_member());
create policy "team uploads to own folder" on storage.objects
for insert to authenticated with check (bucket_id='survey-photos' and public.is_team_member() and (storage.foldername(name))[1]=auth.uid()::text);
create policy "owners and admins delete photos" on storage.objects
for delete to authenticated using (bucket_id='survey-photos' and public.is_team_member() and (owner_id=auth.uid()::text or public.is_team_admin()));

create index if not exists survey_records_surveyed_at_idx on public.survey_records(surveyed_at desc);
create index if not exists survey_records_category_idx on public.survey_records(category);
