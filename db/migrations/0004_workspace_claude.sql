-- 기존 워크스페이스는 설정 전까지 AI 호출을 막는다. 키 원문은 저장하지 않는다.
alter table workspaces add column claude_api_key_env text
  check (claude_api_key_env is null or claude_api_key_env ~ '^CLOUDSIGHT_CLAUDE_KEY_[A-Z][A-Z0-9_]{0,63}$');
