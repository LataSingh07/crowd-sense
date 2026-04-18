drop policy if exists "readings_insert_auth" on public.crowd_readings;
create policy "readings_insert_for_active_camera" on public.crowd_readings
  for insert to authenticated
  with check (
    exists (select 1 from public.cameras c where c.id = camera_id and c.active = true)
  );

drop policy if exists "alerts_insert_auth" on public.alerts;
create policy "alerts_insert_for_active_camera" on public.alerts
  for insert to authenticated
  with check (
    exists (select 1 from public.cameras c where c.id = camera_id and c.active = true)
  );