import { describe, expect, it } from "vitest";
import { parsePrefix, prefixContains, prefixesOverlap, prefixLastAddress } from "./cidr";

describe("parsePrefix", () => {
  it.each([
    ["10.0.0.4/16", 4, "167772160", 16],
    ["10.0.0.4", 4, "167772164", 32],
    ["0.0.0.0/0", 4, "0", 0],
    ["255.255.255.255/32", 4, "4294967295", 32],
    ["fd00::1/8", 6, "336294682933583715844663186250927177728", 8],
    ["::", 6, "0", 128],
    ["2001:db8::4/0", 6, "0", 0],
    ["::ffff:192.0.2.1", 6, "281473902969345", 128],
    ["0:0:0:0:0:0:0:1", 6, "1", 128],
    [" 10.0.0.4/24 ", 4, "167772160", 24],
  ])("parses %s and clears host bits", (value, version, network, length) => {
    expect(parsePrefix(value as string)).toEqual({ version, network: BigInt(network), length });
  });

  it.each(["", "*", "garbage", "10.0.0", "010.0.0.1", "256.1.1.1", "1.2.3.4/33", "::/129", "::/-1", "::/", "::/1/2", "1::2::3", "1:2:3", "gggg::1", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7::8", "10.0.0.1/2.5", "1.2.3.4/+2"])("rejects %s", (value) => {
    expect(parsePrefix(value)).toBeNull();
  });
});

describe("prefixContains", () => {
  it.each([
    ["10.0.0.0/8", "10.2.3.4", true],
    ["10.0.1.4/24", "10.0.1.255", true],
    ["10.0.1.0/24", "10.0.0.0/16", false],
    ["10.0.0.0/24", "10.0.1.0/24", false],
    ["::/0", "fd00::/8", true],
    ["fd00::/8", "fd01::1", true],
    ["::/0", "10.0.0.0/8", null],
    ["bad", "10.0.0.1", null],
    ["10.0.0.0/8", "bad", null],
  ])("%s contains %s: %s", (outer, inner, expected) => {
    expect(prefixContains(outer, inner)).toBe(expected);
  });
});

describe("prefixesOverlap", () => {
  it.each([
    ["10.0.0.0/8", "10.2.0.0/16", true],
    ["10.2.0.0/16", "10.0.0.0/8", true],
    ["10.0.0.0/24", "10.0.1.0/24", false],
    ["fd00::/8", "fd00::1", true],
    ["fd00::/8", "fe00::/8", false],
    ["::/0", "0.0.0.0/0", null],
    ["bad", "::", null],
  ])("%s overlaps %s: %s", (a, b, expected) => {
    expect(prefixesOverlap(a, b)).toBe(expected);
    expect(prefixesOverlap(b, a)).toBe(expected);
  });
});

describe("prefixLastAddress", () => {
  it.each([
    ["0.0.0.0/0", "4294967295"],
    ["10.0.0.4/24", "167772415"],
    ["::/0", "340282366920938463463374607431768211455"],
    ["::1", "1"],
  ])("finds the last address of %s", (value, expected) => {
    expect(prefixLastAddress(parsePrefix(value)!)).toBe(BigInt(expected));
  });
});
