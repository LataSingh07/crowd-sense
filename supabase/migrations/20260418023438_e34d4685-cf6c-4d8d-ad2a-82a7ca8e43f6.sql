create type public.app_role as enum ('admin', 'authority');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  )
$$;

create table public.cameras (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null,
  source_type text not null default 'webcam',
  source_url text,
  area_sqm numeric not null default 50,
  threshold_moderate int not null default 15,
  threshold_danger int not null default 30,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.cameras enable row level security;

create table public.crowd_readings (
  id bigserial primary key,
  camera_id uuid not null references public.cameras(id) on delete cascade,
  people_count int not null,
  density numeric not null,
  status text not null,
  recorded_at timestamptz not null default now()
);
create index crowd_readings_camera_time_idx on public.crowd_readings(camera_id, recorded_at desc);
alter table public.crowd_readings enable row level security;

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references public.cameras(id) on delete cascade,
  severity text not null,
  people_count int not null,
  message text not null,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);
create index alerts_created_idx on public.alerts(created_at desc);
alter table public.alerts enable row level security;

create policy "profiles_select_self_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid());
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy "user_roles_select_self_or_admin" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "user_roles_admin_manage" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "cameras_select_auth" on public.cameras
  for select to authenticated using (true);
create policy "cameras_admin_insert" on public.cameras
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "cameras_admin_update" on public.cameras
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "cameras_admin_delete" on public.cameras
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create policy "readings_select_auth" on public.crowd_readings
  for select to authenticated using (true);
create policy "readings_insert_auth" on public.crowd_readings
  for insert to authenticated with check (true);

create policy "alerts_select_auth" on public.alerts
  for select to authenticated using (true);
create policy "alerts_insert_auth" on public.alerts
  for insert to authenticated with check (true);
create policy "alerts_update_admin" on public.alerts
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  is_first_user boolean;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email);
  select count(*) = 0 into is_first_user from public.user_roles;
  if is_first_user then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'authority');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.crowd_readings;