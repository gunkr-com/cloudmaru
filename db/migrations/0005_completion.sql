-- W0 저장 외피. 의미·카탈로그·인벤토리 검증은 후속 모드 어댑터가 엄격 스키마로 수행한다.
alter table scans add constraint scans_id_workspace_key unique (id, workspace_id);
alter table llm_calls drop constraint llm_calls_source_check;
alter table llm_calls add constraint llm_calls_source_check
  check (source in ('analysis', 'artifact', 'assessment-roadmap', 'extension', 'extension-artifact'));

create function completion_v1(payload jsonb) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(payload) = 'object' and payload->'schemaVersion' = '1'::jsonb, false)
$$;
create function completion_input_bound(payload jsonb, owner uuid, scan uuid) returns boolean
language sql immutable as $$
  select coalesce(completion_v1(payload) and payload->>'workspaceId' = owner::text
    and payload->>'sourceScanId' = scan::text, false)
$$;
create function completion_result_bound(payload jsonb, row_id uuid, owner uuid, scan uuid) returns boolean
language sql immutable as $$
  select coalesce(completion_input_bound(payload, owner, scan) and payload->>'id' = row_id::text
    and payload->'sourceScan'->>'id' = scan::text and payload->'sourceScan'->>'workspaceId' = owner::text
    and payload->'sourceScan'->>'status' = 'succeeded', false)
$$;
create function completion_error_v1(payload jsonb) returns boolean
language sql immutable as $$
  select coalesce(completion_v1(payload) and payload - 'schemaVersion' - 'code' = '{}'::jsonb
    and payload->>'code' in ('missing-data', 'invalid-data', 'unsupported-type', 'unsupported-region',
      'unsupported-path', 'unsupported-service-tag', 'no-applicable-rule', 'policy-not-configured',
      'scope-not-collected', 'collection-partial', 'legacy-completeness-unknown', 'import-scope-unverified', 'context-limit',
      'redacted', 'unmapped-advisor-type', 'price-unavailable', 'capacity-unverified', 'forbidden',
      'not-configured', 'not-supported', 'auth-failed', 'timeout', 'throttled', 'invalid-response',
      'validation-failed', 'interrupted', 'internal', 'no-data'), false)
$$;
create function completion_job_state(job_status text, payload jsonb, coded_error jsonb,
  started timestamptz, completed timestamptz) returns boolean
language sql immutable as $$
  select coalesce(case job_status
    when 'pending' then payload is null and coded_error is null and completed is null
    when 'succeeded' then completion_v1(payload) and coded_error is null and completed >= started
    when 'failed' then payload is null and completion_error_v1(coded_error) and completed >= started
    else false end, false)
$$;

create table assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_scan_id uuid not null,
  previous_scan_id uuid,
  status text not null default 'pending',
  input jsonb not null,
  result jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  roadmap_status text not null default 'not-requested',
  roadmap_attempt_id uuid,
  roadmap_content jsonb,
  roadmap_error jsonb,
  roadmap_usage jsonb,
  roadmap_created_at timestamptz,
  roadmap_completed_at timestamptz,
  foreign key (source_scan_id, workspace_id) references scans(id, workspace_id),
  foreign key (previous_scan_id, workspace_id) references scans(id, workspace_id),
  check (previous_scan_id is null or previous_scan_id <> source_scan_id),
  check (completion_input_bound(input, workspace_id, source_scan_id)
    and input ? 'previousScanId' and (input->'previousScanId' = coalesce(to_jsonb(previous_scan_id), 'null'::jsonb))),
  check (completion_job_state(status, result, error, created_at, completed_at)),
  check (result is null or (completion_result_bound(result, id, workspace_id, source_scan_id)
    and jsonb_typeof(result->'local') = 'object' and jsonb_typeof(result->'advisor') = 'object'
    and completion_v1(result->'actualCost') and jsonb_typeof(result->'diff') = 'object'
    and result->'roadmap' = '{"state":"not-requested"}'::jsonb) is true),
  check ((roadmap_status = 'not-requested' and roadmap_content is null and roadmap_error is null
      and roadmap_created_at is null and roadmap_completed_at is null and roadmap_attempt_id is null)
    or (status = 'succeeded' and roadmap_created_at is not null and roadmap_attempt_id is not null
      and completion_job_state(roadmap_status, roadmap_content, roadmap_error, roadmap_created_at, roadmap_completed_at))),
  check (roadmap_content is null or (completion_v1(roadmap_content)
    and jsonb_typeof(roadmap_content->'summary') = 'object' and jsonb_typeof(roadmap_content->'phases') = 'array') is true)
);
create index assessments_workspace_created_at_idx on assessments(workspace_id, created_at desc);

create table network_diagnostics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_scan_id uuid not null,
  status text not null default 'pending',
  input jsonb not null,
  result jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (source_scan_id, workspace_id) references scans(id, workspace_id),
  check ((completion_input_bound(input, workspace_id, source_scan_id)
    and jsonb_typeof(input->'query') = 'object' and input->'query'->>'sourceScanId' = source_scan_id::text) is true),
  check (completion_job_state(status, result, error, created_at, completed_at)),
  check (result is null or (completion_result_bound(result, id, workspace_id, source_scan_id)
    and result->'query' = input->'query' and jsonb_typeof(result->'engine') = 'object') is true)
);
create index network_diagnostics_workspace_created_at_idx on network_diagnostics(workspace_id, created_at desc);

create table extensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_scan_id uuid not null,
  source_extension_id uuid,
  status text not null default 'pending',
  input jsonb not null,
  result jsonb,
  error jsonb,
  usage jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, workspace_id),
  unique (id, workspace_id, source_scan_id),
  foreign key (source_scan_id, workspace_id) references scans(id, workspace_id),
  foreign key (source_extension_id, workspace_id) references extensions(id, workspace_id),
  check (source_extension_id is null or source_extension_id <> id),
  check (completion_input_bound(input, workspace_id, source_scan_id)),
  check (completion_job_state(status, result, error, created_at, completed_at)),
  check (result is null or (completion_result_bound(result, id, workspace_id, source_scan_id)
    and result->'input' = input and jsonb_typeof(result->'plans') = 'array' and jsonb_array_length(result->'plans') = 3) is true)
);
create index extensions_workspace_created_at_idx on extensions(workspace_id, created_at desc);

create table extension_artifacts (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null default gen_random_uuid(),
  extension_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_scan_id uuid not null,
  tier text not null check (tier in ('low', 'balanced', 'ha')),
  kind text not null check (kind in ('guide', 'evaluation', 'bicep')),
  status text not null default 'pending',
  input jsonb not null,
  content jsonb,
  error jsonb,
  usage jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (extension_id, tier, kind),
  foreign key (extension_id, workspace_id, source_scan_id) references extensions(id, workspace_id, source_scan_id) on delete cascade,
  foreign key (source_scan_id, workspace_id) references scans(id, workspace_id),
  check ((completion_v1(input) and input->>'extensionId' = extension_id::text
    and input->>'tier' = tier and input->>'kind' = kind) is true),
  check (completion_job_state(status, content, error, created_at, completed_at)),
  check (content is null or (completion_input_bound(content, workspace_id, source_scan_id)
    and content->>'id' = id::text and content->>'extensionId' = extension_id::text
    and content->>'tier' = tier and content->>'kind' = kind and jsonb_typeof(content->'content') = 'object') is true)
);
create index extension_artifacts_workspace_created_at_idx on extension_artifacts(workspace_id, created_at desc);

-- 저장된 성공 스캔만 예약한다. 키 확인은 AI를 쓰는 후속 어댑터의 책임이다.
create function reserve_assessment(p_workspace_id uuid, p_source_scan_id uuid, p_previous_scan_id uuid default null)
returns table (id uuid, status text, created boolean)
language sql security invoker set search_path = public, pg_temp as $$
  insert into assessments(workspace_id, source_scan_id, previous_scan_id, input)
  select p_workspace_id, p_source_scan_id, p_previous_scan_id,
    jsonb_build_object('schemaVersion', 1, 'workspaceId', p_workspace_id, 'sourceScanId', p_source_scan_id, 'previousScanId', p_previous_scan_id)
  from scans s where s.id = p_source_scan_id and s.workspace_id = p_workspace_id and s.status = 'succeeded'
    and (p_previous_scan_id is null or (p_previous_scan_id <> p_source_scan_id and exists
      (select 1 from scans p where p.id = p_previous_scan_id and p.workspace_id = p_workspace_id and p.status = 'succeeded')))
  returning id, status, true
$$;
create function reserve_network_diagnostic(p_workspace_id uuid, p_source_scan_id uuid, p_input jsonb)
returns table (id uuid, status text, created boolean)
language sql security invoker set search_path = public, pg_temp as $$
  insert into network_diagnostics(workspace_id, source_scan_id, input)
  select p_workspace_id, p_source_scan_id, p_input from scans s
  where s.id = p_source_scan_id and s.workspace_id = p_workspace_id and s.status = 'succeeded'
  returning id, status, true
$$;
create function reserve_extension(p_workspace_id uuid, p_source_scan_id uuid, p_input jsonb, p_source_extension_id uuid default null)
returns table (id uuid, status text, created boolean)
language sql security invoker set search_path = public, pg_temp as $$
  insert into extensions(workspace_id, source_scan_id, input, source_extension_id)
  select p_workspace_id, p_source_scan_id, p_input, p_source_extension_id from scans s
  where s.id = p_source_scan_id and s.workspace_id = p_workspace_id and s.status = 'succeeded'
    and (p_source_extension_id is null or exists (select 1 from extensions e where e.id = p_source_extension_id and e.workspace_id = p_workspace_id))
  returning id, status, true
$$;

create function reserve_assessment_roadmap(p_assessment_id uuid, p_stale_before timestamptz)
returns table (id uuid, status text, created boolean, attempt_id uuid)
language plpgsql security invoker set search_path = public, pg_temp as $$
declare assessment assessments%rowtype;
begin
  select a.* into assessment from assessments a join scans s on s.id = a.source_scan_id and s.workspace_id = a.workspace_id
    where a.id = p_assessment_id and a.status = 'succeeded' and s.status = 'succeeded' for update of a;
  if not found then return; end if;
  if assessment.roadmap_status = 'succeeded' or (assessment.roadmap_status = 'pending' and assessment.roadmap_created_at >= p_stale_before) then
    id := assessment.id; status := assessment.roadmap_status; created := false;
    attempt_id := assessment.roadmap_attempt_id; return next; return;
  end if;
  update assessments a set roadmap_status = 'pending', roadmap_content = null, roadmap_error = null,
    roadmap_attempt_id = gen_random_uuid(), roadmap_created_at = now(), roadmap_completed_at = null
    where a.id = assessment.id returning a.roadmap_attempt_id into attempt_id;
  id := assessment.id; status := 'pending'; created := true; return next;
end;
$$;

create function reserve_extension_artifact(p_extension_id uuid, p_tier text, p_kind text, p_stale_before timestamptz)
returns table (id uuid, status text, created boolean, attempt_id uuid)
language plpgsql security invoker set search_path = public, pg_temp as $$
declare parent extensions%rowtype; artifact extension_artifacts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('extension-artifact:' || p_extension_id::text || ':' || p_tier || ':' || p_kind, 0));
  select e.* into parent from extensions e join scans s on s.id = e.source_scan_id and s.workspace_id = e.workspace_id
    where e.id = p_extension_id and e.status = 'succeeded' and s.status = 'succeeded' for share of e;
  if not found then return; end if;
  select ar.* into artifact from extension_artifacts ar
    where ar.extension_id = p_extension_id and ar.tier = p_tier and ar.kind = p_kind for update;
  if found then
    if artifact.status = 'succeeded' or (artifact.status = 'pending' and artifact.created_at >= p_stale_before) then
      id := artifact.id; status := artifact.status; created := false;
      attempt_id := artifact.attempt_id; return next; return;
    end if;
    -- 실패한 시도의 usage와 llm_calls는 보존한다.
    update extension_artifacts ar set status = 'pending', content = null, error = null,
      attempt_id = gen_random_uuid(), created_at = now(), completed_at = null
      where ar.id = artifact.id returning ar.attempt_id into attempt_id;
    id := artifact.id; status := 'pending'; created := true; return next; return;
  end if;
  insert into extension_artifacts(extension_id, workspace_id, source_scan_id, tier, kind, input)
    values (parent.id, parent.workspace_id, parent.source_scan_id, p_tier, p_kind,
      jsonb_build_object('schemaVersion', 1, 'extensionId', parent.id, 'tier', p_tier, 'kind', p_kind)) returning * into artifact;
  id := artifact.id; status := artifact.status; created := true;
  attempt_id := artifact.attempt_id; return next;
end;
$$;
