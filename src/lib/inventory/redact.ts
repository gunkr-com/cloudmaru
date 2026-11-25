const SECRET_KEY_PARTS = [
  "secret", "password", "token", "key", "credential", "thumbprint", "connectionstring", "privatekey", "private_key",
];
const MAX_CONTEXT_STRING = 500;

/** 원본 키 판정·길이 제한에 더해 연결 문자열 값도 가린다. */
export function redactForModel(value: unknown, key = "", depth = 0): unknown {
  const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
  if (SECRET_KEY_PARTS.some((part) => normalizedKey.includes(part))) return "[redacted]";
  if (depth >= 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactForModel(item, "", depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([itemKey, itemValue]) => [
      itemKey, redactForModel(itemValue, itemKey, depth + 1),
    ]));
  }
  if (typeof value === "string") {
    // 저장소 계정 키, Service Bus·Event Hubs·IoT Hub 키, SAS 토큰, SAS URL 서명(sig=)
    if (/AccountKey=|SharedAccessKey=|SharedAccessSignature=|Password=|[?&]sig=/i.test(value)) return "[redacted]";
    // Python 원본처럼 유니코드 코드 포인트 단위로 자른다.
    const characters = Array.from(value);
    return characters.length <= MAX_CONTEXT_STRING ? value : characters.slice(0, MAX_CONTEXT_STRING).join("") + "…[truncated]";
  }
  return value;
}
