import { parsePrefix, prefixContains, prefixLastAddress, type ParsedPrefix } from "./cidr";

import type { NetworkReasonCode } from "@/types/network-diagnostics";

// ADR-024: 태그 식별은 정적 근사 범위의 소속 증거가 아니다.
const APPROXIMATE_TAGS = new Set([
  "virtualnetworkgateway", "gatewaymanager", "azurecloud", "azureactivedirectory",
  "storage", "sql", "sqlmanagement", "apimanagement", "azurekeyvault",
  "azurecontainerregistry", "azureweb", "anysastaff",
]);
export function resolveServiceTag(tag: string): readonly ParsedPrefix[] | null {
  switch (tag.trim().toLowerCase()) {
    case "azureloadbalancer": return [parsePrefix("168.63.129.16/32")!];
    case "internet": return [parsePrefix("0.0.0.0/0")!, parsePrefix("::/0")!];
    default: return null;
  }
}
export function isServiceTag(value: string): boolean {
  const tag = value.trim().toLowerCase();
  return tag === "virtualnetwork" || APPROXIMATE_TAGS.has(tag) || resolveServiceTag(tag) !== null;
}
export function serviceTagReason(tag: string): NetworkReasonCode {
  const canonical = tag.trim().toLowerCase();
  return canonical === "virtualnetwork" ? "virtual-network-scope-incomplete"
    : APPROXIMATE_TAGS.has(canonical) ? "service-tag-approximate" : "service-tag-unsupported";
}

const PRIVATE4 = ["0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.0.170/31", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "255.255.255.255/32"];
const RESERVED4 = ["240.0.0.0/4"];
const PRIVATE_EXCEPTIONS4 = ["192.0.0.9/32", "192.0.0.10/32"];
const PRIVATE6 = ["::1/128", "::/128", "::ffff:0.0.0.0/96", "64:ff9b:1::/48", "100::/64", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20", "fc00::/7", "fe80::/10"];
const RESERVED6 = ["::/8", "100::/8", "200::/7", "400::/6", "800::/5", "1000::/4", "4000::/3", "6000::/3", "8000::/3", "a000::/3", "c000::/3", "e000::/4", "f000::/5", "f800::/6", "fe00::/9"];
const PRIVATE_EXCEPTIONS6 = ["2001:1::1/128", "2001:1::2/128", "2001:3::/32", "2001:4:112::/48", "2001:20::/28", "2001:30::/28"];

function containsAddress(range: string, prefix: ParsedPrefix, address: bigint): boolean {
  const outer = parsePrefix(range)!;
  const shift = BigInt((prefix.version === 4 ? 32 : 128) - outer.length);
  return outer.version === prefix.version && (address >> shift) === (outer.network >> shift);
}

function inInternet(prefix: ParsedPrefix): boolean | null {
  const privateRanges = prefix.version === 4 ? PRIVATE4 : PRIVATE6;
  const exceptions = prefix.version === 4 ? PRIVATE_EXCEPTIONS4 : PRIVATE_EXCEPTIONS6;
  const specialRanges = prefix.version === 4
    ? [...RESERVED4, "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "0.0.0.0/32"]
    : [...RESERVED6, "fe80::/10", "ff00::/8", "::1/128", "::/128"];
  const last = prefixLastAddress(prefix);
  const covers = (range: string) => containsAddress(range, prefix, prefix.network) && containsAddress(range, prefix, last);
  const overlaps = (range: string) => {
    const parsed = parsePrefix(range)!;
    return parsed.version === prefix.version && parsed.network <= last && prefix.network <= prefixLastAddress(parsed);
  };
  if (specialRanges.some(covers)) return false;
  if (exceptions.some(covers)) return true;
  if (privateRanges.some(covers) && !exceptions.some(overlaps)) return false;
  // 사설·특수 범위 경계를 걸치면 전체를 Internet 트래픽으로 확정하지 않는다.
  if ([...privateRanges, ...specialRanges].some(overlaps)) return null;
  return true;
}

export function addressPrefixMatchesTag(tag: string, requestedPrefix: string): boolean | null {
  const canonical = tag.trim().toLowerCase();
  const requested = parsePrefix(requestedPrefix);
  if (!requested || resolveServiceTag(canonical) === null) return null;
  if (canonical === "internet") return inInternet(requested);
  const exact = "168.63.129.16/32";
  if (prefixContains(exact, requestedPrefix) === true) return true;
  return prefixContains(requestedPrefix, exact) === true ? null : false;
}
