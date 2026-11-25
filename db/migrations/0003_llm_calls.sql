-- 원 행이 지워져도 호출 비용은 남긴다. 프롬프트·응답 본문은 저장하지 않는다.
create table llm_calls (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('analysis', 'artifact')),
  source_id uuid not null,
  prompt_tokens integer not null check (prompt_tokens >= 0),
  completion_tokens integer not null check (completion_tokens >= 0),
  cost_usd double precision check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index llm_calls_created_at_idx on llm_calls (created_at);

-- 옛 결과물의 합산 usage는 호출별로 나눌 수 없어 한 건으로 옮긴다.
-- 형식을 먼저 확인하고 숫자 범위까지 검증한 뒤 새 컬럼 타입으로 변환한다.
with legacy as (
  select 'analysis' as source, id as source_id, usage, coalesce(completed_at, created_at) as called_at from analyses
  union all
  select 'artifact', id, usage, coalesce(completed_at, created_at) from artifacts
), valid as materialized (
  select * from legacy
  where case when jsonb_typeof(usage) = 'object'
    and jsonb_typeof(usage->'promptTokens') = 'number'
    and jsonb_typeof(usage->'completionTokens') = 'number'
    and jsonb_typeof(usage->'costUsd') in ('number', 'null')
  then (usage->>'promptTokens')::numeric between 0 and 2147483647
    and trunc((usage->>'promptTokens')::numeric) = (usage->>'promptTokens')::numeric
    and (usage->>'completionTokens')::numeric between 0 and 2147483647
    and trunc((usage->>'completionTokens')::numeric) = (usage->>'completionTokens')::numeric
    and (usage->>'costUsd' is null or (usage->>'costUsd')::numeric between 0 and 1.7976931348623157e308)
  else false end
)
insert into llm_calls(source, source_id, prompt_tokens, completion_tokens, cost_usd, created_at)
select source, source_id, (usage->>'promptTokens')::numeric::integer,
  (usage->>'completionTokens')::numeric::integer, (usage->>'costUsd')::double precision, called_at
from valid;
