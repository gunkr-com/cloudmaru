export type ParsedPrefix = { version: 4 | 6; network: bigint; length: number };

const ZERO = BigInt(0);
const ONE = BigInt(1);

function ipv4(value: string): bigint | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((address, part) => (address << BigInt(8)) + BigInt(part), ZERO);
}

function ipv6(value: string): bigint | null {
  let text = value;
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    const tail = ipv4(text.slice(lastColon + 1));
    if (lastColon < 0 || tail === null) return null;
    text = `${text.slice(0, lastColon)}:${(tail >> BigInt(16)).toString(16)}:${(tail & BigInt(65535)).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const count = left.length + right.length;
  if (halves.length === 1 ? count !== 8 : count >= 8) return null;
  const parts = [...left, ...Array<string>(8 - count).fill("0"), ...right];
  if (parts.some((part) => !/^[a-fA-F0-9]{1,4}$/.test(part))) return null;
  return parts.reduce((address, part) => (address << BigInt(16)) + BigInt(`0x${part}`), ZERO);
}

/** Python ip_network(strict=False)와 같이 호스트 비트를 지운다. */
export function parsePrefix(value: string): ParsedPrefix | null {
  const parts = value.trim().split("/");
  if (parts.length > 2) return null;
  const version = parts[0].includes(":") ? 6 : 4;
  const bits = version === 4 ? 32 : 128;
  const length = parts.length === 1 ? bits : /^[0-9]+$/.test(parts[1]) ? Number(parts[1]) : NaN;
  if (!Number.isInteger(length) || length < 0 || length > bits) return null;
  const address = version === 4 ? ipv4(parts[0]) : ipv6(parts[0]);
  if (address === null) return null;
  const shift = BigInt(bits - length);
  return { version, network: (address >> shift) << shift, length };
}

export function prefixContains(outer: string, inner: string): boolean | null {
  const a = parsePrefix(outer);
  const b = parsePrefix(inner);
  if (!a || !b || a.version !== b.version) return null;
  const shift = BigInt((a.version === 4 ? 32 : 128) - a.length);
  return a.length <= b.length && (b.network >> shift) === (a.network >> shift);
}

export function prefixesOverlap(a: string, b: string): boolean | null {
  const contains = prefixContains(a, b);
  return contains === null ? null : contains || prefixContains(b, a) === true;
}

export function prefixLastAddress(prefix: ParsedPrefix): bigint {
  return prefix.network + (ONE << BigInt((prefix.version === 4 ? 32 : 128) - prefix.length)) - ONE;
}
