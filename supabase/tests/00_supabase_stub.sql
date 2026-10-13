-- Minimal stand-in for Supabase's auth/storage schemas so the migration
-- can be tested on plain PostgreSQL (NOT for production use).
do $$ begin if not exists (select 1 from pg_roles where rolname=$q$anon$q$) then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname=$q$authenticated$q$) then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname=$q$service_role$q$) then create role service_role nologin bypassrls; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- PostgREST login role (local end-to-end runs only)
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then
  create role authenticator noinherit login password 'authpass'; end if; end $$;
grant anon, authenticated to authenticator;
