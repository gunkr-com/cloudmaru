create table scans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null check (source in ('live', 'import')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  subscription_ids text[] not null default '{}',
  inventory jsonb,
  summary jsonb,
  collected_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint scans_succeeded_check check (status <> 'succeeded' or (inventory is not null and summary is not null and collected_at is not null)),
  constraint scans_failed_check check (status <> 'failed' or error_code is not null)
);
create index scans_workspace_created_at_idx on scans (workspace_id, created_at desc);
