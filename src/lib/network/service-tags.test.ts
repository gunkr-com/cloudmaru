import { describe, expect, it } from "vitest";
import { parsePrefix } from "./cidr";
import { addressPrefixMatchesTag, isServiceTag, resolveServiceTag } from "./service-tags";

describe("TestResolveServiceTag", () => {
  it("test_known_tag_returns_networks", () => {
    const result = resolveServiceTag("AzureLoadBalancer");
    expect(result).not.toBeNull();
    expect(result?.length).toBeGreaterThan(0);
    for (const net of result ?? []) expect(net).toMatchObject({ version: expect.any(Number), network: expect.any(BigInt), length: expect.any(Number) });
  });
  it("test_known_tag_case_insensitive", () => {
    expect(resolveServiceTag("azureloadbalancer")).not.toBeNull();
    expect(resolveServiceTag("AZURELOADBALANCER")).not.toBeNull();
    expect(resolveServiceTag("AzureLoadBalancer")).not.toBeNull();
  });
  it("test_internet_tag_resolves_to_catchall", () => {
    const result = resolveServiceTag("Internet");
    expect(result).not.toBeNull();
    expect(result).toContainEqual(parsePrefix("0.0.0.0/0"));
  });
  it("test_azureloadbalancer_tag_resolves", () => {
    const result = resolveServiceTag("AzureLoadBalancer");
    expect(result).not.toBeNull();
    expect(result).toContainEqual(parsePrefix("168.63.129.16/32"));
  });
  it("test_storage_tag_resolves", () => {
    const result = resolveServiceTag("Storage");
    expect(result).toBeNull();
  });
  it("test_unknown_tag_returns_none", () => {
    expect(resolveServiceTag("FakeUnknownTag")).toBe(null);
  });
  it("test_empty_string_returns_none", () => {
    expect(resolveServiceTag("")).toBe(null);
  });
  it("test_whitespace_stripped", () => {
    expect(resolveServiceTag("  AzureLoadBalancer  ")).not.toBeNull();
  });
  it("test_sql_tag_resolves", () => {
    expect(resolveServiceTag("Sql")).toBeNull();
  });
  it("test_azurecloud_tag_resolves", () => {
    expect(resolveServiceTag("AzureCloud")).toBeNull();
  });
});

describe("TestIsServiceTag", () => {
  it("test_virtualnetwork_is_tag", () => {
    expect(isServiceTag("VirtualNetwork")).toBe(true);
  });
  it("test_internet_is_tag", () => {
    expect(isServiceTag("Internet")).toBe(true);
  });
  it("test_storage_is_tag", () => {
    expect(isServiceTag("Storage")).toBe(true);
  });
  it("test_ip_address_is_not_tag", () => {
    expect(isServiceTag("10.0.0.4")).toBe(false);
  });
  it("test_cidr_is_not_tag", () => {
    expect(isServiceTag("10.0.0.0/16")).toBe(false);
  });
  it("test_wildcard_is_not_tag", () => {
    expect(isServiceTag("*")).toBe(false);
  });
  it("test_unknown_string_is_not_tag", () => {
    expect(isServiceTag("MyCustomPrefix")).toBe(false);
  });
  it("test_empty_is_not_tag", () => {
    expect(isServiceTag("")).toBe(false);
  });
  it("test_case_insensitive", () => {
    expect(isServiceTag("virtualnetwork")).toBe(true);
    expect(isServiceTag("STORAGE")).toBe(true);
  });
});

describe("TestAddressPrefixMatchesTag", () => {
  it("test_rfc1918_in_virtualnetwork", () => {
    const result = addressPrefixMatchesTag("VirtualNetwork", "10.0.0.4/32");
    expect(result).toBe(null);
  });
  it("test_rfc1918_172_in_virtualnetwork", () => {
    const result = addressPrefixMatchesTag("VirtualNetwork", "172.16.5.0/24");
    expect(result).toBe(null);
  });
  it("test_rfc1918_192_in_virtualnetwork", () => {
    const result = addressPrefixMatchesTag("VirtualNetwork", "192.168.1.0/24");
    expect(result).toBe(null);
  });
  it("test_public_ip_not_in_virtualnetwork", () => {
    const result = addressPrefixMatchesTag("VirtualNetwork", "4.2.0.0/16");
    expect(result).toBe(null);
  });
  it("test_public_ip_in_internet", () => {
    const result = addressPrefixMatchesTag("Internet", "8.8.8.8/32");
    expect(result).toBe(true);
  });
  it("test_private_ip_not_in_internet", () => {
    const result = addressPrefixMatchesTag("Internet", "10.0.0.4/32");
    expect(result).toBe(false);
  });
  it("test_cgnat_shared_space_not_in_internet", () => {
    const result = addressPrefixMatchesTag("Internet", "100.64.1.1/32");
    expect(result).toBe(false);
  });
  it("test_public_ipv6_in_internet", () => {
    const result = addressPrefixMatchesTag("Internet", "2606:4700:4700::1111/128");
    expect(result).toBe(true);
  });
  it("test_ula_ipv6_not_in_internet", () => {
    const result = addressPrefixMatchesTag("Internet", "fd00::/48");
    expect(result).toBe(false);
  });
  it("test_rfc1918_not_in_storage", () => {
    const result = addressPrefixMatchesTag("Storage", "10.0.0.0/16");
    expect(result).toBe(null);
  });
  it("test_unknown_tag_returns_none", () => {
    const result = addressPrefixMatchesTag("FakeTag", "10.0.0.0/16");
    expect(result).toBe(null);
  });
  it("test_unparseable_prefix_returns_none", () => {
    const result = addressPrefixMatchesTag("VirtualNetwork", "not-a-prefix");
    expect(result).toBe(null);
  });
  it("test_ipv6_fd_in_virtualnetwork", () => {
    const result = addressPrefixMatchesTag("VirtualNetwork", "fd00::/48");
    expect(result).toBe(null);
  });
  it("test_azurelb_ip_in_tag", () => {
    const result = addressPrefixMatchesTag("AzureLoadBalancer", "168.63.129.16/32");
    expect(result).toBe(true);
  });
  it("test_non_azurelb_ip_not_in_tag", () => {
    const result = addressPrefixMatchesTag("AzureLoadBalancer", "10.0.0.1/32");
    expect(result).toBe(false);
  });
});

describe("Internet special-use ranges", () => {
  it.each([
    "0.0.0.0", "127.0.0.1", "169.254.0.1", "192.0.2.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "ff02::1", "2001:db8::1", "fc00::1", "::ffff:8.8.8.8",
  ])("excludes %s", (prefix) => {
    expect(addressPrefixMatchesTag("Internet", prefix)).toBe(false);
  });
  it.each(["8.8.8.8", "1.2.3.4", "192.0.0.9", "2001:4860:4860::8888", "2606:4700:4700::/48"])("includes %s", (prefix) => {
    expect(addressPrefixMatchesTag("Internet", prefix)).toBe(true);
  });
});

describe("tag lookup boundaries", () => {
  it.each(["constructor", "toString", "__proto__", "Storage.CanadaCentral"])("does not resolve unknown tag %s", (tag) => {
    expect(resolveServiceTag(tag)).toBeNull();
    expect(isServiceTag(tag)).toBe(false);
    expect(addressPrefixMatchesTag(tag, "10.0.0.1")).toBeNull();
  });
  it("normalizes host bits, case, and whitespace", () => {
    expect(addressPrefixMatchesTag(" AZURELOADBALANCER ", " 168.63.129.16 ")).toBe(true);
  });
  it("does not match the other address family", () => {
    expect(addressPrefixMatchesTag("Storage", "fd00::1")).toBeNull();
  });
  it("does not expose mutable cached networks", () => {
    const networks = resolveServiceTag("AzureLoadBalancer")!;
    networks[0].length = 0;
    expect(resolveServiceTag("AzureLoadBalancer")![0].length).toBe(32);
  });
});

describe("ADR-024 exact membership only", () => {
  it.each(["Storage", "AzureCloud", "GatewayManager", "VirtualNetwork", "Storage.CanadaCentral"])("%s without exact context is unknown", tag => {
    expect(addressPrefixMatchesTag(tag, "20.1.2.3")).toBeNull();
  });
  it("ULA is not AzureLoadBalancer", () => {
    expect(addressPrefixMatchesTag("AzureLoadBalancer", "fd00::1")).toBe(false);
    expect(addressPrefixMatchesTag("AzureCloud", "fd00::1")).toBeNull();
  });
  it("mixed public/special-use ranges are uncertain", () => {
    expect(addressPrefixMatchesTag("Internet", "0.0.0.0/0")).toBeNull();
    expect(addressPrefixMatchesTag("Internet", "2000::/3")).toBeNull();
  });
});
