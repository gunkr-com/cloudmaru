// @vitest-environment node
import { describe, expect, it } from "vitest";
import { redactInventoryDisplay, compareScans, ScanDiffError } from "./diff";
import { normalizeResourceRow } from "./normalize";
import { splitSubnets } from "./split-subnets";
import { summarizeInventory } from "./summarize";
import { scanDiffSchema } from "@/lib/completion/schema";
import type { ScanInventory, ScanRecord } from "@/types/scan";

const subscription = "00000000-0000-4000-8000-000000000001";
const workspace = "00000000-0000-4000-8000-000000000002";
const time = "2026-11-11T12:00:00Z";
const id = (name: string) => `/subscriptions/${subscription}/resourcegroups/rg/providers/microsoft.web/sites/${name}`;
function resource(name: string, properties: Record<string, unknown> = { httpsOnly: true }) {
  return normalizeResourceRow({ id: id(name), name, type: "microsoft.web/sites", subscriptionId: subscription,
    resourceGroup: "rg", location: "canadacentral", kind: null, sku: null, tags: {}, zones: [], managedBy: null, properties });
}
function snapshot(resources = [resource("keep"), resource("old")], later = false) {
  const inventory: ScanInventory = { resources, containers: [], relations: [], skippedRows: 0 };
  const scan: ScanRecord = { id: `00000000-0000-4000-8000-00000000000${later ? 4 : 3}`, workspaceId: workspace,
    source: "live", status: "succeeded", subscriptionIds: [subscription], summary: summarizeInventory(resources, []),
    collectedAt: time, createdAt: time, completedAt: time, errorCode: null };
  return { scan, inventory };
}
const compare = (a = snapshot(), b = snapshot([resource("keep", { httpsOnly: false }), resource("new")], true)) =>
  compareScans(a, b, time);

describe("saved scan comparison", () => {
  it("compares subnet properties without requiring top-level ARM metadata absent from child resources", () => {
    const vnetId = `/subscriptions/${subscription}/resourcegroups/rg/providers/microsoft.network/virtualnetworks/vnet`;
    const subnetId = `${vnetId}/subnets/apps`;
    const nsg = `/subscriptions/${subscription}/resourcegroups/rg/providers/microsoft.network/networksecuritygroups/`;
    const rows = (target: string) => splitSubnets([normalizeResourceRow({
      id:vnetId, name:"vnet", type:"microsoft.network/virtualnetworks", subscriptionId:subscription, resourceGroup:"rg",
      location:"canadacentral", tags:{}, zones:[], managedBy:null, sku:null, kind:null,
      properties:{subnets:[{id:subnetId,name:"apps",properties:{networkSecurityGroup:{id:nsg+target}}}]},
    })]);
    const a = snapshot(rows("before")); const b = snapshot(rows("after"), true);
    expect(a.inventory.resources.find(row => row.id === subnetId)!.observedFields).toEqual(["properties","location"]);
    const result = compare(a,b);
    expect(result.counts).toEqual({added:0, removed:0, changed:2, unknown:0});
    expect(result.changes.find(row => row.resourceId === subnetId)).toMatchObject({kind:"changed", properties:[
      {path:"/properties/networkSecurityGroup/id",before:{state:"present",value:nsg+"before"},after:{state:"present",value:nsg+"after"}},
    ]});
    delete b.inventory.resources.find(row => row.id === subnetId)!.observedFields;
    expect(compare(a,b).changes.find(row => row.resourceId === subnetId)).toMatchObject({kind:"unknown",reasons:["legacy-completeness-unknown"]});
  });
  it("retains non-secret authorization/key configuration flags while hiding credentials", () => {
    const a = snapshot([resource("keep", {allowSharedKeyAccess: true, enableRbacAuthorization: false, apiKey: "private-old"})]);
    const b = snapshot([resource("keep", {allowSharedKeyAccess: false, enableRbacAuthorization: true, apiKey: "private-new"})], true);
    const result = compare(a,b);
    expect(result.counts.changed).toBe(1);
    expect(result.changes[0]).toMatchObject({kind: "changed", properties: [
      {path: "/properties/allowSharedKeyAccess", before: {state:"present", value:true}, after: {state:"present", value:false}},
      {path: "/properties/enableRbacAuthorization", before: {state:"present", value:false}, after: {state:"present", value:true}},
    ]});
    expect(JSON.stringify(result)).not.toMatch(/apiKey|private-old|private-new/);
  });
  it("produces exact additions, removals and JSON Pointer property evidence", () => {
    const result = compare();
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 1, unknown: 0 });
    expect(result.changes).toEqual([
      { kind: "changed", resourceId: id("keep"), properties: [{ path: "/properties/httpsOnly", before: { state: "present", value: true }, after: { state: "present", value: false } }] },
      { kind: "added", resourceId: id("new") }, { kind: "removed", resourceId: id("old") },
    ]);
    expect(scanDiffSchema.parse(result)).toEqual(result);
    expect(result.coverage).toEqual({ total: 3, included: 3, excluded: 0, reasons: [] });
  });
  it.each(["skipped", "import", "unread", "legacy"])("does not infer a removal from %s scope", mode => {
    const a = snapshot(); const b = snapshot([resource("keep")], true);
    if (mode === "skipped") b.inventory.skippedRows = 1;
    if (mode === "import") b.scan.source = "import";
    if (mode === "unread") b.scan.subscriptionIds.push("00000000-0000-4000-8000-000000000099");
    if (mode === "legacy") delete b.inventory.resources[0].observedFields;
    expect(compare(a, b).changes.find(c => c.resourceId === id("old"))).toMatchObject({ kind: "unknown" });
  });
  it("treats a resource in newly included subscription as unknown", () => {
    const a = snapshot(); const b = snapshot([...a.inventory.resources, resource("new")], true);
    const other = "00000000-0000-4000-8000-000000000099";
    b.inventory.resources[2] = { ...resource("new"), id: id("new").replace(subscription, other), subscriptionId: other };
    b.scan.subscriptionIds.push(other);
    expect(compare(a, b).changes).toEqual([{ kind: "unknown", resourceId: b.inventory.resources[2].id, reasons: ["scope-not-collected"] }]);
  });
  it("does not manufacture legacy cleared metadata or ignore unavailable properties", () => {
    const a = snapshot([resource("keep")]); const b = snapshot([resource("keep")], true);
    a.inventory.resources[0].tags = { owner: "ops" }; a.inventory.resources[0].zones = ["1"];
    delete b.inventory.resources[0].observedFields;
    expect(compare(a, b).counts).toEqual({ added: 0, removed: 0, changed: 0, unknown: 1 });
    b.inventory.resources[0].observedFields = ["tags", "zones", "managedBy", "sku", "location", "kind"];
    expect(compare(a, b).changes[0]).toMatchObject({ kind: "unknown", reasons: ["missing-data"] });
  });
  it("ignores object order, zones set order, canonical ARM ID case and snapshot order", () => {
    const a = snapshot(); const b = snapshot([...a.inventory.resources].reverse().map(r => structuredClone(r)), true);
    a.inventory.resources[0].zones = ["1", "2"]; b.inventory.resources[1].zones = ["2", "1", "1"];
    a.inventory.resources[0].properties = { a: 1, b: { x: true, y: false } };
    b.inventory.resources[1].properties = { b: { y: false, x: true }, a: 1 };
    b.inventory.resources[1].id = id("keep").toUpperCase();
    expect(compare(a, b).changes).toEqual([]);
  });
  it("preserves ordered arrays and every entry beyond twenty", () => {
    const values = Array.from({ length: 30 }, (_, i) => i);
    const a = snapshot([resource("keep", { steps: values })]); const b = snapshot([resource("keep", { steps: [...values.slice(0, 29), 99] })], true);
    expect(compare(a, b).changes[0]).toMatchObject({ kind: "changed", properties: [{ path: "/properties/steps/29", before: { state: "present", value: 29 }, after: { state: "present", value: 99 } }] });
    b.inventory.resources[0].properties.steps = [...values].reverse();
    expect(compare(a, b).counts.changed).toBe(1);
  });
  it("preserves explicit null versus missing and escapes JSON Pointer keys", () => {
    const a = snapshot([resource("keep", { "a/b~c": null })]); const b = snapshot([resource("keep", {})], true);
    expect(compare(a, b).changes[0]).toMatchObject({ properties: [{ path: "/properties/a~1b~0c", before: { state: "present", value: null }, after: { state: "missing" } }] });
  });
  it("masks secret keys, secret-shaped values and array fields before comparing", () => {
    const secret = "AccountKey=hidden-sentinel";
    const a = snapshot([resource("keep", { password: "old-secret", safe: [secret], [secret]: "hidden", nested: { token: "old" } })]);
    const b = snapshot([resource("keep", { password: "new-secret", safe: ["Password=new-sentinel"], "Password=new-key": "new", nested: { token: "new" } })], true);
    expect(compare(a, b).changes).toEqual([]);
    b.inventory.resources[0].properties.visible = true;
    const output = JSON.stringify(compare(a, b));
    for (const value of [secret, "old-secret", "new-secret", "new-sentinel", "new-key"]) expect(output).not.toContain(value);
  });
  it.each(["env", "environmentVariables", "appSettings"])("redacts name/value secrets in %s without truncating public settings", field => {
    const a = snapshot([resource("keep", {[field]: []})]);
    const entries = [{name:"DB_PASSWORD",value:"plain-private-sentinel"}, {name:"PUBLIC_MODE",value:"production"}];
    const b = snapshot([resource("keep", {[field]: entries})], true);
    const result = compare(a,b);
    expect(JSON.stringify(result)).not.toContain("plain-private-sentinel");
    expect(result.changes[0]).toMatchObject({kind:"changed",properties:expect.arrayContaining([
      {path:`/properties/${field}/0`,before:{state:"missing"},after:{state:"present",value:{name:"DB_PASSWORD",value:"[redacted]"}}},
      {path:`/properties/${field}/1`,before:{state:"missing"},after:{state:"present",value:{name:"PUBLIC_MODE",value:"production"}}},
    ])});
    const next = snapshot([resource("keep", {[field]: [{...entries[0],value:"different-private-sentinel"}, entries[1]]})]);
    next.scan.id = a.scan.id;
    expect(compare(next,b).counts.changed).toBe(0);
    expect(b.inventory.resources[0].properties[field]).toEqual(entries);
  });
  it("redacts secure values and secure template defaults even with non-secret display names", () => {
    const a = snapshot([resource("keep", {settings: []})]);
    const b = snapshot([resource("keep", {settings:[
      {name:"endpoint",secureValue:"aci-private-sentinel"},
      {key:"API_TOKEN",value:"key-pair-private-sentinel"},
      {name:"credentials",type:"secureString",defaultValue:"default-private-sentinel"},
    ]})],true);
    const result = JSON.stringify(compare(a,b));
    for (const secret of ["aci-private-sentinel","key-pair-private-sentinel","default-private-sentinel"]) expect(result).not.toContain(secret);
  });
  it.each(["postgresql://user:private-url-pass@db.invalid/app", "mongodb+srv://private-user@db.invalid/app", "Server=db.invalid;Uid=user;Pwd=plain-private-pwd", "sig=private-bare-signature"])("masks credential-bearing connection values before comparison: %s", value => {
    const a = snapshot([resource("keep", {env:[]})]);
    const b = snapshot([resource("keep", {env:[{name:"DATABASE_URL",value}]})],true);
    const result = compare(a,b);
    expect(JSON.stringify(result)).not.toContain(value);
    expect(result.changes[0]).toMatchObject({kind:"changed",properties:[
      {path:"/properties/env/0",before:{state:"missing"},after:{state:"present",value:{name:"DATABASE_URL",value:"[redacted]"}}},
    ]});
  });
  it("retains only allowlisted non-secret Key Vault permissions and Storage key-source fields", () => {
    const typed = (type: string, name: string, properties: Record<string,unknown>) => ({...resource(name,properties),
      id:`/subscriptions/${subscription}/resourcegroups/rg/providers/${type}/${name}`,type});
    const vault = (permissions: Record<string,unknown>) => typed("microsoft.keyvault/vaults","vault",{accessPolicies:[{permissions}], actualKey:"raw-key-private-sentinel"});
    const storage = (keySource: string) => typed("microsoft.storage/storageaccounts","storage",{encryption:{keySource,keyValue:"raw-value-private-sentinel"}});
    const result = compare(snapshot([vault({keys:["get"],secrets:["get"]}),storage("Microsoft.Storage")]),
      snapshot([vault({keys:["get","sign"],secrets:["get","list"]}),storage("Microsoft.Keyvault")],true));
    expect(result.counts.changed).toBe(2);
    expect(result.changes.find(row => row.resourceId.includes("/microsoft.keyvault/vaults/"))).toMatchObject({kind:"changed",properties:expect.arrayContaining([
      {path:"/properties/accessPolicies/0/permissions/keys",before:{state:"present",value:["get"]},after:{state:"present",value:["get","sign"]}},
      {path:"/properties/accessPolicies/0/permissions/secrets",before:{state:"present",value:["get"]},after:{state:"present",value:["get","list"]}},
    ])});
    expect(JSON.stringify(result)).toContain("/properties/encryption/keySource");
    expect(JSON.stringify(result)).not.toContain("private-sentinel");
    expect(compare(snapshot([vault({keys:["Get","list"]})]),snapshot([vault({keys:["LIST","get","get"]})],true)).counts.changed).toBe(0);
    const mixed = compare(snapshot([vault({keys:["get","list"]})]),snapshot([vault({keys:["delete","get"]})],true));
    expect(mixed.changes).toEqual([{kind:"changed",resourceId:`/subscriptions/${subscription}/resourcegroups/rg/providers/microsoft.keyvault/vaults/vault`,properties:[
      {path:"/properties/accessPolicies/0/permissions/keys",before:{state:"present",value:["get","list"]},after:{state:"present",value:["delete","get"]}},
    ]}]);
    const invalid = compare(snapshot([vault({keys:[]})]),snapshot([vault({keys:["unrecognized-private-sentinel"]})],true));
    expect(JSON.stringify(invalid)).not.toContain("unrecognized-private-sentinel");
    expect(JSON.stringify(invalid)).toContain("[redacted]");
  });
  it("keeps public URLs with @ outside their authority", () => {
    const values = ["https://docs.invalid/users/name@example.invalid", "https://docs.invalid/search?email=name@example.invalid"];
    const result = compare(snapshot([resource("keep",{urls:[]})]),snapshot([resource("keep",{urls:values})],true));
    for (const value of values) expect(JSON.stringify(result)).toContain(value);
  });
  it("keeps public configuration exceptions bound to exact resource types and JSON Pointer paths", () => {
    for (const [type, field] of [["microsoft.web/sites","accessPolicies"],["microsoft.keyvault/vaults","accessPolicies/0/permissions"]]) {
      const row = (operation: string) => ({...resource("keep",{[field]: field === "accessPolicies" ? [{permissions:{keys:[operation]}}] : {keys:[operation]}}),
        id:`/subscriptions/${subscription}/resourcegroups/rg/providers/${type}/keep`, type});
      expect(compare(snapshot([row("get")]),snapshot([row("list")],true)).counts.changed).toBe(0);
    }
    const a = snapshot([resource("keep",{encryption:{keySource:"Microsoft.Storage"}})]);
    const b = snapshot([resource("keep",{encryption:{keySource:"Microsoft.Keyvault"}})],true);
    expect(compare(a,b).counts.changed).toBe(0);
  });
  it("never includes secrets inside newly added objects or arrays", () => {
    const a = snapshot([resource("keep", {})]); const b = snapshot([resource("keep", { entries: [{ password: "hidden-sentinel", text: "Bearer abc.def.ghi" }] })], true);
    const output = JSON.stringify(compare(a, b)); expect(output).not.toContain("hidden-sentinel"); expect(output).not.toContain("abc.def.ghi");
  });
  it.each(["workspace", "same", "failed", "time", "duplicate", "invalid", "json"])("rejects %s with a sanitized coded error", mode => {
    const a = snapshot(); const b = snapshot(undefined, true);
    if (mode === "workspace") b.scan.workspaceId = "00000000-0000-4000-8000-000000000099";
    if (mode === "same") b.scan.id = a.scan.id;
    if (mode === "failed") b.scan.status = "failed";
    if (mode === "time") b.scan.collectedAt = "2025-01-01T00:00:00Z";
    if (mode === "duplicate") b.inventory.resources.push(b.inventory.resources[0]);
    if (mode === "invalid") b.inventory.resources[0].id = "hidden-sentinel";
    if (mode === "json") b.inventory.resources[0].properties.value = NaN;
    expect(() => compare(a, b)).toThrow(ScanDiffError);
    try { compare(a, b); } catch (error) { expect(error).toHaveProperty("code"); expect(String(error)).not.toContain("hidden-sentinel"); }
  });
  it("normalizes named ARM configuration collections without sorting ordered application arrays", () => {
    const rules = [{ name: "allow", properties: { priority: 100 } }, { name: "deny", properties: { priority: 200 } }];
    const a = snapshot([resource("keep", { securityRules: rules })]);
    const b = snapshot([resource("keep", { securityRules: [...rules].reverse() })], true);
    for (const snapshot of [a, b]) {
      const row = snapshot.inventory.resources[0];
      row.type = "microsoft.network/networksecuritygroups";
      row.id = row.id.replace("microsoft.web/sites", "microsoft.network/networksecuritygroups");
    }
    expect(compare(a, b).changes).toEqual([]);
  });
  it("preserves application arrays even when named like network set fields", () => {
    const a = snapshot([resource("keep", { addressPrefixes: ["a", "b"] })]);
    const b = snapshot([resource("keep", { addressPrefixes: ["b", "a"] })], true);
    expect(compare(a, b).counts.changed).toBe(1);
  });
  it("retains full added array evidence beyond twenty without truncation", () => {
    const entries = Array.from({ length: 35 }, (_, i) => ({ position: i }));
    const result = compare(snapshot([resource("keep", {})]), snapshot([resource("keep", { entries })], true));
    expect(result.changes[0]).toMatchObject({ properties: [{ path: "/properties/entries", before: { state: "missing" }, after: { state: "present", value: entries } }] });
  });
  it("suppresses secret key additions and removals and masks tag evidence", () => {
    const a = snapshot([resource("keep")]); const b = snapshot([resource("keep")], true);
    a.inventory.resources[0].properties.password = "removed-sentinel";
    b.inventory.resources[0].properties.apiKey = "added-sentinel";
    a.inventory.resources[0].tags = { note: "AccountKey=tag-sentinel" };
    b.inventory.resources[0].tags = { note: "Password=next-sentinel" };
    expect(compare(a, b).changes).toEqual([]);
  });
  it("rejects secret-shaped resource identities instead of exposing them as provenance", () => {
    const a = snapshot(); const b = snapshot(undefined, true);
    b.inventory.resources[0].id = id("AccountKey=identity-sentinel");
    expect(() => compare(a, b)).toThrow(ScanDiffError);
  });
  it("reports explicit observed tag clearing and ordered array append", () => {
    const a = snapshot([resource("keep", { steps: [1] })]); const b = snapshot([resource("keep", { steps: [1, 2] })], true);
    a.inventory.resources[0].tags = { owner: "ops" };
    expect(compare(a, b).changes[0]).toMatchObject({ properties: [
      { path: "/tags/owner", before: { state: "present", value: "ops" }, after: { state: "missing" } },
      { path: "/properties/steps/1", before: { state: "missing" }, after: { state: "present", value: 2 } },
    ] });
  });
  it("does not mutate either saved snapshot", () => {
    const a = snapshot(); const b = snapshot(undefined, true); const before = JSON.stringify([a, b]);
    compare(a, b); expect(JSON.stringify([a, b])).toBe(before);
  });
});


describe("redactInventoryDisplay",()=>{
 it.each(["postgresql://user:private-url-pass@db.invalid/app","Server=db.invalid;Uid=user;Pwd=private-pwd","sig=private-signature"])("reuses credential-shaped value policy without scan comparison: %s",value=>{
  expect(redactInventoryDisplay(value,"/properties/endpoint","microsoft.web/sites")).toEqual({path:"/properties/endpoint",value:"[redacted]"});
 });
 it.each(["/properties/password","/properties/api~1Key","/properties/credentials/plain","/tags/secret-note"])("masks secret paths and their scalar evidence %s",path=>{
  const result=redactInventoryDisplay("not-obviously-a-secret",path,"microsoft.web/sites");
  expect(result.value).toBe("[redacted]");expect(result.path).toContain("[redacted]");
  expect(JSON.stringify(result)).not.toContain("not-obviously-a-secret");
  expect(result.path).not.toMatch(/password|api~1Key|credentials|secret-note/);
 });
 it("reuses named-secret row logic, recursively filters paths and preserves public configuration",()=>{
  const input={appSettings:[{name:"DB_PASSWORD",value:"named-private"},{name:"PUBLIC_MODE",value:"production"}],httpsOnly:true};
  const before=structuredClone(input),result=redactInventoryDisplay(input,"/properties","microsoft.web/sites");
  expect(result).toEqual({path:"/properties",value:{appSettings:[{name:"DB_PASSWORD",value:"[redacted]"},{name:"PUBLIC_MODE",value:"production"}],httpsOnly:true}});
  expect(input).toEqual(before);
  expect(redactInventoryDisplay("isolated-private","/properties/appSettings/0/value","microsoft.web/sites").value).toBe("[redacted]");
 });
 it("preserves exact public permission/encryption exceptions and security booleans",()=>{
  expect(redactInventoryDisplay(["get","list"],"/properties/accessPolicies/0/permissions/secrets","microsoft.keyvault/vaults")).toEqual({path:"/properties/accessPolicies/0/permissions/secrets",value:["get","list"]});
  expect(redactInventoryDisplay("microsoft.storage","/properties/encryption/keySource","microsoft.storage/storageaccounts").value).toBe("Microsoft.Storage");
  expect(redactInventoryDisplay(false,"/properties/allowSharedKeyAccess","microsoft.storage/storageaccounts").value).toBe(false);
  expect(redactInventoryDisplay("hidden","/properties/encryption/keySource","microsoft.web/sites").value).toBe("[redacted]");
 });
 it.each(["bad","/properties/~2bad"])("rejects malformed pointers without reflecting inputs %s",path=>{
  expect(()=>redactInventoryDisplay("sensitive",path,"")).toThrow("invalid-snapshot");
 });
 it("rejects invalid JSON without mutation or secret-bearing errors",()=>{
  const cycle:{next?:unknown}={};cycle.next=cycle;
  for(const value of [cycle,NaN,undefined,new Date()]) expect(()=>redactInventoryDisplay(value,"","")).toThrow("invalid-snapshot");
  expect(redactInventoryDisplay({mode:"public"},"","")).toEqual({path:"",value:{mode:"public"}});
 });
});
it.each(["Pwd","sig"])("display redaction masks short credential keys as paths and nested values: %s",key=>{
 const result=redactInventoryDisplay("short-key-private",`/properties/${key}`,"microsoft.web/sites");
 expect(result.value).toBe("[redacted]");expect(result.path).toBe("/properties/[redacted]");
 expect(JSON.stringify(redactInventoryDisplay({[key]:"nested-short-private"},"/properties","microsoft.web/sites"))).not.toContain("nested-short-private");
});
it("display redaction sanitizes getter errors and does not truncate public arrays",()=>{
 expect(()=>redactInventoryDisplay({get value(){throw new Error("private-getter-message");}},"","")).toThrow("invalid-snapshot");
 const values=Array.from({length:40},(_,index)=>({mode:`public-${index}`}));
 expect(redactInventoryDisplay(values,"/properties/items","").value).toHaveLength(40);
});
