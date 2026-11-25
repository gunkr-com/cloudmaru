import { ExtendBicepError } from './bicep-source';
import type { BicepProgram, BicepResource, BicepValue } from './bicep-source';

export const BICEP_COMPILER_POLICY = 'extend-bicep-source-arm-v1';
export const BICEP_CLI_VERSION = '0.49.2';
export const BICEP_CLI_COMMIT = 'b34271ac51';
const generatorVersion = '0.49.2.45890';
const fail = (): never => { throw new ExtendBicepError('compiled-template-mismatch'); };
function canonical(raw: unknown): string {
  let nodes = 0;
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 20000 || depth > 64) fail();
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(v => visit(v, depth + 1));
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, visit(v, depth + 1)]));
    }
    return fail();
  }
  return JSON.stringify(visit(raw, 0));
}
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";

/** Pure second check after validateBoundBicep. Never trusts the emitted resource list to prove existing safety. */
export function validateCompiledTemplate(raw: unknown, program: BicepProgram): { generatorVersion: string; resourceCount: number } {
  canonical(raw); // Bounds the complete tree, including metadata and rejected fields.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const template = raw as Record<string, unknown>;
  if (!Array.isArray(template.resources) || template.resources.length > 200 || program.resources.length > 200
    || program.parameters.length > 40) return fail();
  const bySymbol = new Map(program.resources.map(r => [r.symbol, r]));
  const guard=program.zoneInputGuard?'deploymentEnabled':'deploymentTargetMatches';
  if(program.zoneInputGuard&&(!program.deploymentTarget||!program.parameters.some(p=>'type' in p&&p.type==='array'&&p.name==='deploymentZones')))return fail();
  if (bySymbol.size !== program.resources.length) return fail();
  const get = (symbol: string) => bySymbol.get(symbol) ?? fail();
  function ancestry(resource: BicepResource, seen = new Set<string>()): BicepResource[] {
    if (seen.has(resource.symbol) || seen.size > 32) return fail();
    seen.add(resource.symbol);
    const parent = resource.body.properties.parent;
    if (parent === undefined) return [resource];
    if (!parent || typeof parent !== 'object' || Array.isArray(parent) || parent.kind !== 'reference' || parent.property) return fail();
    return [...ancestry(get(parent.symbol), seen), resource];
  }
  function names(resource: BicepResource) {
    return ancestry(resource).map(r => typeof r.body.properties.name === 'string' ? r.body.properties.name : fail());
  }
  function idExpression(resource: BicepResource): string {
    const chain = ancestry(resource), root = chain[0], scope = root.body.properties.scope;
    const args = [resource.type.split('@')[0], ...names(resource)].map(quote).join(', ');
    if (scope === undefined) return `resourceId(${args})`;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || scope.kind !== 'call' || scope.name !== 'resourceGroup') return fail();
    return `extensionResourceId(format('/subscriptions/{0}/resourceGroups/{1}', ${scope.arguments.map(quote).join(', ')}), ${args})`;
  }
  function nameValue(resource: BicepResource): string {
    const segments = names(resource);
    if (segments.length === 1) return segments[0];
    return `[format(${quote(segments.map((_, i) => `{${i}}`).join('/'))}, ${segments.map(quote).join(', ')})]`;
  }
  function value(v: BicepValue, dependencies: Set<string>, containingResource:BicepResource,property?:string): unknown {
    if (typeof v === 'string') return v.startsWith('[') ? '[' + v : v;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(item => value(item, dependencies,containingResource));
    if (v.kind === 'object') return Object.fromEntries(Object.entries(v.properties).map(([k, item]) => [k, value(item, dependencies,containingResource,k)]));
    if (v.kind === 'tenant-id') return '[subscription().tenantId]';
    if(v.kind==='container-cpu'){
      if(containingResource.type.split('@')[0]!=='Microsoft.App/containerApps'||property!=='cpu'||!Number.isFinite(v.value)||v.value<0.25||v.value>4||!Number.isInteger(v.value*4))return fail();
      return `[json(${quote(String(v.value))})]`;
    }
    if(v.kind==='deployment-zone'){
      if(!program.zoneInputGuard||(v.index!==0&&v.index!==1))return fail();
      return `[parameters('deploymentZones')[${v.index}]]`;
    }
    if(v.kind==='guarded-new-site-hostname'){
      const site=get(v.symbol);
      if(!program.deploymentTarget||site.existing||site.guarded!==(program.zoneInputGuard?'deploymentEnabled':true)||site.type.split('@')[0]!=='Microsoft.Web/sites'||(v.guard??'deploymentTargetMatches')!==guard)return fail();
      dependencies.add(`[${idExpression(site)}]`);
      return `[if(variables('${guard}'), reference(${idExpression(site)}, ${quote(site.type.split('@')[1])}).defaultHostName, '')]`;
    }
    if(v.kind==='gateway-child-id'){
      const parent=program.resources.find(r=>r.type.split('@')[0]==='Microsoft.Network/applicationGateways'&&r.body.properties.name===v.gatewayName);
      if(!parent||parent.existing||!parent.guarded||!program.deploymentTarget)return fail();
      return `[resourceId(${quote(v.type)}, ${quote(v.gatewayName)}, ${quote(v.childName)})]`;
    }
    if(v.kind==='reference'&&!v.property&&program.parameters.some(p=>p.name===v.symbol))return `[parameters(${quote(v.symbol)})]`;
    if (v.kind !== 'reference' || !v.property) return fail();
    const resource = get(v.symbol);
    if (!resource.existing) dependencies.add(`[${idExpression(resource)}]`);
    if (v.property === 'name') return nameValue(resource);
    if (v.property === 'id') return `[${idExpression(resource)}]`;
    return fail();
  }
  const expected = program.resources.filter(r => !r.existing).map(resource => {
    const dependencies = new Set<string>();
    // Bicep emits the direct new parent's dependency; ancestors are transitive.
    const parent=ancestry(resource).at(-2);
    if(parent&&!parent.existing)dependencies.add(`[${idExpression(parent)}]`);
    const props = resource.body.properties;
    // Cross-scope new declarations require nested deployments, which this contract deliberately refuses.
    if (props.scope !== undefined) return fail();
    if (program.deploymentTarget && resource.guarded!==(program.zoneInputGuard?'deploymentEnabled':true)) return fail();
    const result: Record<string, unknown> = { ...(resource.guarded ? {condition: `[variables('${guard}')]`} : {}), type: resource.type.split('@')[0], apiVersion: resource.type.split('@')[1], name: nameValue(resource) };
    for (const [k, v] of Object.entries(props)) if (k !== 'name' && k !== 'parent') result[k] = value(v, dependencies,resource,k);
    if (dependencies.size) result.dependsOn = [...dependencies].sort();
    return result;
  });
  const actual = template.resources.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const result = { ...item } as Record<string, unknown>;
    if ('dependsOn' in result) {
      if (!Array.isArray(result.dependsOn) || result.dependsOn.some(v => typeof v !== 'string')) return fail();
      result.dependsOn = [...result.dependsOn].sort();
    }
    return result;
  });
  // Resource order and object key order carry no deployment semantics; every other field is exact.
  if (canonical(expected.map(canonical).sort()) !== canonical(actual.map(canonical).sort())) return fail();
  const metadata = template.metadata as { _generator?: Record<string, unknown> } | undefined;
  const generator = metadata?._generator;
  if (!generator || generator.name !== 'bicep' || generator.version !== generatorVersion
    || typeof generator.templateHash !== 'string' || !/^\d{1,30}$/.test(generator.templateHash)) return fail();
  const header = { ...template }; delete header.resources;
  if (canonical(header) !== canonical({
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    ...(program.parameters.length ? {parameters:Object.fromEntries(program.parameters.map(p=>[p.name,{
      ...('secure' in p?{type:'securestring'}:p.type==='int'?{type:'int',minValue:p.minimum,maxValue:p.maximum}:p.type==='array'?{type:'array',allowedValues:p.allowed,minLength:p.minLength,maxLength:p.maxLength}:{type:'string',minLength:p.minLength,maxLength:p.maxLength}),
      ...(p.description?{metadata:{description:p.description}}:{})}]))} : {}),
    ...(program.deploymentTarget ? { variables: {deploymentTargetMatches: `[equals(toLower(resourceGroup().id), ${quote(program.deploymentTarget)})]`,...(program.zoneInputGuard?{deploymentInputsValid:"[equals(length(union(parameters('deploymentZones'), parameters('deploymentZones'))), length(parameters('deploymentZones')))]",deploymentEnabled:"[and(variables('deploymentTargetMatches'), variables('deploymentInputsValid'))]"}:{})}, outputs: {deploymentTargetMatched: {type:'bool',value: "[variables('deploymentTargetMatches')]"}} } : {}),
    metadata: { _generator: { name: 'bicep', version: generatorVersion, templateHash: generator.templateHash } },
  })) return fail();
  return { generatorVersion, resourceCount: actual.length };
}
