create table if not exists public.pitch_results (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player_id text not null,
  threshold_cents double precision not null check (threshold_cents > 0 and threshold_cents < 10000),
  closest_correct_cents double precision check (closest_correct_cents is null or closest_correct_cents > 0),
  final_gap_cents double precision not null check (final_gap_cents > 0),
  attempts integer not null check (attempts > 0 and attempts < 10000),
  correct integer not null check (correct >= 0 and correct <= attempts),
  mistakes integer not null check (mistakes >= 0),
  accuracy integer not null check (accuracy >= 0 and accuracy <= 100),
  percentile integer not null check (percentile >= 0 and percentile <= 100),
  band text not null,
  tone_type text not null,
  device_type text not null check (device_type in ('mobile', 'desktop')),
  viewport_width integer,
  viewport_height integer
);

alter table public.pitch_results enable row level security;

drop policy if exists "Anyone can submit pitch results" on public.pitch_results;
create policy "Anyone can submit pitch results"
on public.pitch_results
for insert
to anon
with check (true);

drop policy if exists "Anyone can read pitch results" on public.pitch_results;
create policy "Anyone can read pitch results"
on public.pitch_results
for select
to anon
using (true);

create index if not exists pitch_results_threshold_idx on public.pitch_results (threshold_cents);
create index if not exists pitch_results_created_at_idx on public.pitch_results (created_at desc);
