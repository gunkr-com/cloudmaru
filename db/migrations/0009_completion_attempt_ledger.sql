-- Remember superseded attempts before a retry replaces the public current-attempt pointer.
-- Aggregate parent usage cannot be attributed to a particular historical attempt.
create function completion_usage_valid(payload jsonb) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(payload) = 'object'
    and payload ?& array['promptTokens','completionTokens','costUsd']
    and payload - 'promptTokens' - 'completionTokens' - 'costUsd' = '{}'::jsonb
    and jsonb_typeof(payload->'promptTokens') = 'number'
    and jsonb_typeof(payload->'completionTokens') = 'number'
    and (payload->>'promptTokens')::numeric between 0 and 9007199254740991
    and (payload->>'completionTokens')::numeric between 0 and 9007199254740991
    and trunc((payload->>'promptTokens')::numeric) = (payload->>'promptTokens')::numeric
    and trunc((payload->>'completionTokens')::numeric) = (payload->>'completionTokens')::numeric
    and (payload->'costUsd' = 'null'::jsonb or
      (jsonb_typeof(payload->'costUsd') = 'number' and (payload->>'costUsd')::numeric >= 0)),false)
$$;

create table assessment_roadmap_attempts (
  attempt_id uuid primary key,
  assessment_id uuid not null references assessments(id) on delete cascade,
  usage jsonb check (usage is null or completion_usage_valid(usage)),
  created_at timestamptz not null default now()
);
create index assessment_roadmap_attempts_parent_idx on assessment_roadmap_attempts(assessment_id);
create table extension_artifact_attempts (
  attempt_id uuid primary key,
  artifact_id uuid not null references extension_artifacts(id) on delete cascade,
  usage jsonb check (usage is null or completion_usage_valid(usage)),
  created_at timestamptz not null default now()
);
create index extension_artifact_attempts_parent_idx on extension_artifact_attempts(artifact_id);

insert into assessment_roadmap_attempts(assessment_id,attempt_id,created_at)
  select id,roadmap_attempt_id,roadmap_created_at from assessments where roadmap_attempt_id is not null;
insert into extension_artifact_attempts(artifact_id,attempt_id,created_at)
  select id,attempt_id,created_at from extension_artifacts;

create function register_completion_attempt() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if TG_TABLE_NAME = 'assessments' then
    if NEW.roadmap_attempt_id is not null then
      insert into assessment_roadmap_attempts(assessment_id,attempt_id) values (NEW.id,NEW.roadmap_attempt_id);
    end if;
  else
    insert into extension_artifact_attempts(artifact_id,attempt_id) values (NEW.id,NEW.attempt_id);
  end if;
  return NEW;
end;
$$;
create trigger assessment_attempt_insert after insert on assessments
  for each row execute function register_completion_attempt();
create trigger assessment_attempt_renew after update of roadmap_attempt_id on assessments
  for each row when (OLD.roadmap_attempt_id is distinct from NEW.roadmap_attempt_id)
  execute function register_completion_attempt();
create trigger artifact_attempt_insert after insert on extension_artifacts
  for each row execute function register_completion_attempt();
create trigger artifact_attempt_renew after update of attempt_id on extension_artifacts
  for each row when (OLD.attempt_id is distinct from NEW.attempt_id)
  execute function register_completion_attempt();

create function protect_completion_attempt() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (to_jsonb(OLD) - 'usage') is distinct from (to_jsonb(NEW) - 'usage')
    or (OLD.usage is not null and OLD.usage is distinct from NEW.usage) then
    raise exception 'completion-attempt-immutable';
  end if;
  return NEW;
end;
$$;
create trigger assessment_attempt_immutable before update on assessment_roadmap_attempts
  for each row execute function protect_completion_attempt();
create trigger artifact_attempt_immutable before update on extension_artifact_attempts
  for each row execute function protect_completion_attempt();
