-- 회사 하나. Azure 연결에는 비밀 값 대신 파일 경로와 환경 변수 이름만 둔다.
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  company_name text,
  default_region text not null default 'canadacentral',
  currency text not null default 'CAD' check (currency = 'CAD'),
  azure_connection jsonb,
  subscription_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  input jsonb not null,
  result jsonb,
  error_stage text check (error_stage in ('llm', 'validation', 'internal')),
  usage jsonb,
  source_analysis_id uuid references analyses(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint analyses_succeeded_result_check check (status <> 'succeeded' or result is not null)
);
create index analyses_workspace_created_at_idx on analyses (workspace_id, created_at desc);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  tier text not null check (tier in ('low', 'balanced', 'ha')),
  kind text not null check (kind in ('guide', 'evaluation', 'bicep')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  content jsonb,
  usage jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint artifacts_analysis_tier_kind_key unique (analysis_id, tier, kind),
  constraint artifacts_succeeded_content_check check (status <> 'succeeded' or content is not null)
);

create or replace function reserve_artifact(
  p_analysis_id uuid, p_tier text, p_kind text, p_stale_before timestamptz
) returns table (id uuid, status text, created boolean)
language plpgsql security invoker set search_path = public, pg_temp as $$
declare artifact artifacts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('artifact:' || p_analysis_id::text || ':' || p_tier || ':' || p_kind, 0));
  if not exists (select 1 from analyses a where a.id = p_analysis_id and a.status = 'succeeded') then return; end if;
  select ar.* into artifact from artifacts ar where ar.analysis_id = p_analysis_id and ar.tier = p_tier and ar.kind = p_kind for update;
  if found then
    if artifact.status = 'succeeded' then id := artifact.id; status := artifact.status; created := false; return next; return; end if;
    if artifact.status = 'pending' and artifact.created_at >= p_stale_before then id := artifact.id; status := artifact.status; created := false; return next; return; end if;
    -- usage는 지우지 않는다. 실패한 시도도 API 비용을 썼고, 저장 함수가 다음 시도의 사용량을 더한다.
    update artifacts ar set status = 'pending', content = null, created_at = now(), completed_at = null where ar.id = artifact.id returning ar.* into artifact;
    id := artifact.id; status := artifact.status; created := true; return next; return;
  end if;
  insert into artifacts(analysis_id, tier, kind)
  values (p_analysis_id, p_tier, p_kind) returning * into artifact;
  id := artifact.id; status := artifact.status; created := true; return next;
end;
$$;

