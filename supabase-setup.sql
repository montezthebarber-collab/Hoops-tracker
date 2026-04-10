-- ============================================================
-- HOOPS TRACKER — Supabase Database Setup
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- 1. TABLES

create table if not exists players (
  id text primary key,
  name text not null,
  number text default '',
  created_at timestamptz default now()
);

create table if not exists games (
  id text primary key,
  date text not null,
  opponent text default '',
  result text default '',
  created_at timestamptz default now()
);

create table if not exists gamelogs (
  id text primary key,
  player_id text references players(id) on delete cascade,
  game_id text references games(id) on delete cascade,
  pts int default 0,
  fgm int default 0,
  fga int default 0,
  tpm int default 0,
  tpa int default 0,
  ftm int default 0,
  fta int default 0,
  oreb int default 0,
  dreb int default 0,
  ast int default 0,
  stl int default 0,
  blk int default 0,
  tov int default 0,
  pf int default 0,
  created_at timestamptz default now()
);

-- 2. ROW LEVEL SECURITY (open access — fine for a private league app)

alter table players  enable row level security;
alter table games    enable row level security;
alter table gamelogs enable row level security;

create policy "Public read/write players"  on players  for all using (true) with check (true);
create policy "Public read/write games"    on games    for all using (true) with check (true);
create policy "Public read/write gamelogs" on gamelogs for all using (true) with check (true);

-- 3. REAL-TIME (lets all devices see changes instantly)

alter publication supabase_realtime add table players;
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table gamelogs;
