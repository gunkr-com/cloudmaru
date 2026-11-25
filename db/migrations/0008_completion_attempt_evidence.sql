-- Private validation evidence follows the exact model attempt, without changing public result schemas.
create table assessment_roadmap_evidence (
  assessment_id uuid not null references assessments(id) on delete cascade,
  attempt_id uuid not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (assessment_id,attempt_id),
  check (coalesce(completion_v1(evidence)
    and evidence->>'basisDigest' ~ '^[a-f0-9]{64}$'
    and evidence->>'contentDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(evidence->'validation') = 'object'
    and evidence->'validation'->>'policyVersion' ~ '^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,79}$',false))
);
create table extension_artifact_evidence (
  artifact_id uuid not null references extension_artifacts(id) on delete cascade,
  attempt_id uuid not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (artifact_id,attempt_id),
  check (coalesce(completion_v1(evidence)
    and evidence->>'basisDigest' ~ '^[a-f0-9]{64}$'
    and evidence->>'contentDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(evidence->'validation') = 'object'
    and evidence->'validation'->>'policyVersion' ~ '^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,79}$',false))
);
