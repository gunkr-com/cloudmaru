import { describe, expect, it } from "vitest";
import { DEMO_HOST, demoServerEnv, demoStartUrl, isNextReadyLine, nextLocalPort, parseDemoArgs } from "./launch";

const folders = { dataDirectory: "/synthetic/demo/data", secretsDirectory: "/synthetic/demo/secrets", dotenvNames: [] as string[] };

describe("offline demo launcher", () => {
  it("binds only to the loopback address and prints an Overview start URL", () => {
    expect(DEMO_HOST).toBe("127.0.0.1");
    expect(demoStartUrl(41234)).toBe("http://127.0.0.1:41234/overview");
    for (const port of [0, -1, 65536, 1.5, Number.NaN]) expect(() => demoStartUrl(port)).toThrow("demo-port-invalid");
  });

  it("accepts no target, host or port options", () => {
    expect(parseDemoArgs([])).toEqual({ mode: "start" });
    // The dev server reloads dotenv files on edit, so the demo runs only the production server.
    for (const args of [["--dev"], ["--port", "3000"], ["--host", "0.0.0.0"], ["--data", "/company"], ["--dev", "--dev"]]) {
      expect(() => parseDemoArgs(args)).toThrow("demo-args-invalid");
    }
  });

  it("drops inherited credentials, blanks dotenv names and pins the isolated demo folders", () => {
    const env = demoServerEnv({
      PATH: "/usr/bin", HOME: "/home/example", LANG: "en_US.UTF-8", ANTHROPIC_API_KEY: "synthetic-secret-a",
      AZURE_CLIENT_SECRET: "synthetic-secret-b", CLOUDSIGHT_CLAUDE_KEY_ACME: "synthetic-secret-c", NODE_OPTIONS: "--require /x.cjs",
      CLOUDMARU_PRICES_FILE: "/company/prices.json", CLOUDSIGHT_ALLOWED_HOSTS: "company.example", CLOUDSIGHT_SECRETS_DIR: "/company/secrets",
    }, { ...folders, dotenvNames: ["CLOUDSIGHT_CERT_PASSWORD_ACME", "ANTHROPIC_API_KEY", "CLOUDSIGHT_DATA_DIR", "dotted.key", "dashed-key", "bad=name", "bad name", ""] });
    expect(env).toMatchObject({
      PATH: "/usr/bin", HOME: "/home/example", LANG: "en_US.UTF-8",
      CLOUDSIGHT_DATA_DIR: "/synthetic/demo/data", CLOUDSIGHT_SECRETS_DIR: "/synthetic/demo/secrets",
      CLOUDSIGHT_DEMO: "1", NEXT_TELEMETRY_DISABLED: "1", CLOUDSIGHT_ALLOWED_HOSTS: "", ANTHROPIC_API_KEY: "",
      CLOUDMARU_PRICES_FILE: "", CLAUDE_MODEL: "", CLOUDSIGHT_CERT_PASSWORD_ACME: "", "dotted.key": "", "dashed-key": "",
    });
    for (const name of ["AZURE_CLIENT_SECRET", "CLOUDSIGHT_CLAUDE_KEY_ACME", "NODE_OPTIONS", "bad=name", "bad name", ""]) expect(name in env).toBe(false);
    expect(JSON.stringify(env)).not.toMatch(/synthetic-secret|company/);
  });

  it("refuses to run over an inherited data directory", () => {
    expect(() => demoServerEnv({ CLOUDSIGHT_DATA_DIR: "/company/data" }, folders)).toThrow("demo-existing-environment");
    expect(() => demoServerEnv({ CLOUDSIGHT_DATA_DIR: "  " }, folders)).not.toThrow();
  });
});

describe("demo server readiness from the child's own log", () => {
  it("reads the OS-assigned loopback port only from this child's Local line", () => {
    expect(nextLocalPort("   - Local:         http://127.0.0.1:53124")).toBe(53124);
    expect(nextLocalPort("\u001b[2m - Local:        http://127.0.0.1:41000\u001b[22m")).toBe(41000);
    for (const line of ["- Local: http://localhost:3000", "- Local: http://0.0.0.0:3000", "- Network: http://127.0.0.1:3000",
      "- Local: http://127.0.0.1:0", "- Local: http://127.0.0.1:70000", "Local http://127.0.0.1:3000"]) expect(nextLocalPort(line)).toBeNull();
  });
  it("recognises the ready event", () => {
    expect(isNextReadyLine(" ✓ Ready in 412ms")).toBe(true);
    expect(isNextReadyLine("\u001b[32m✓\u001b[39m Ready in 1.2s")).toBe(true);
    expect(isNextReadyLine("Getting ready...")).toBe(false);
  });
});
