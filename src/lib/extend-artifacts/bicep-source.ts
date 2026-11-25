// 모든 토큰을 소비하는 제한 문법. 컴파일러를 호출하거나 파일을 읽지 않는다.
export class ExtendBicepError extends Error {
  constructor(public readonly code: string, public readonly position = 0) {
    super(`bicep:${position}: ${code}`); this.name = 'ExtendBicepError';
  }
}
export type BicepValue = string | number | boolean | null | BicepValue[] | BicepObject
  | { kind: 'reference'; symbol: string; property?: 'id' | 'name' }
  | { kind: 'tenant-id' }
  | { kind: 'guarded-new-site-hostname'; symbol:string; guard?:'deploymentEnabled' }
  | { kind: 'deployment-zone'; index:0|1 }
  | { kind: 'container-cpu'; value:number }
  | { kind: 'gateway-child-id'; type:string; gatewayName:string; childName:string }
  | { kind: 'call'; name: 'resourceGroup'; arguments: [string, string] };
export type BicepObject = { kind: 'object'; properties: Record<string, BicepValue> };
export type BicepResource = { symbol: string; type: string; existing: boolean; guarded?: true|'deploymentEnabled'; body: BicepObject };
export type BicepParameter = ({secure:true}|{type:'int';minimum:1;maximum:65535}|{type:'string';minLength:1;maxLength:80}|{type:'array';minLength:2;maxLength:3;allowed:['1','2','3']}) & {name:string;description?:string};
export type BicepProgram = { deploymentTarget?: string; targetOutput?: true; zoneInputGuard?:true; parameters:BicepParameter[]; resources: BicepResource[] };
const gatewayChildTypes=new Set(['frontendIPConfigurations','frontendPorts','backendAddressPools','backendHttpSettingsCollection','httpListeners','requestRoutingRules','probes','sslCertificates']
 .map(type=>'Microsoft.Network/applicationGateways/'+type));
type Token = { kind: 'id' | 'string' | 'number' | 'punct' | 'end'; value: string; position: number };
function tokenize(source: string): Token[] {
  if (!source.trim() || source.length > 60000) throw new ExtendBicepError('source-size');
  const tokens: Token[] = []; let i = 0;
  const fail = (code: string): never => { throw new ExtendBicepError(code, i); };
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2); if (end < 0) fail('unterminated-comment'); i = end + 2; continue;
    }
    const position = i;
    if (source.startsWith("'''", i)) {
      i += 3; const end = source.indexOf("'''", i); if (end < 0) fail('unterminated-string');
      // 여러 줄 문자열의 시작 줄바꿈을 처리하고 보간하지 않는다.
      if (source[i] !== '\n' && !source.startsWith('\r\n', i)) fail('multiline-opening-newline');
      const value = source.slice(i, end).replace(/^\r?\n/, '');
      tokens.push({kind:'string', value, position}); i = end + 3; continue;
    }
    if (source[i] === "'") {
      i++; let value = ''; let closed = false;
      while (i < source.length) {
        const char = source[i++];
        if (char === "'") { closed = true; break; }
        if (char === '\n' || char === '\r') fail('unterminated-string');
        if (char === '$' && source[i] === '{') fail('interpolation-not-supported-use-symbol-reference');
        if (char === '\\') {
          const escaped = source[i++];
          const escapes: Record<string, string> = {n:'\n',r:'\r',t:'\t',"'":"'",'\\':'\\','$':'$'};
          if (!(escaped in escapes)) fail('unsupported-string-escape'); value += escapes[escaped];
        } else value += char;
      }
      if (!closed) fail('unterminated-string');
      if (/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\r\n\t]/g,''))) fail('control-character');
      tokens.push({kind:'string',value,position}); continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (id) { tokens.push({kind:'id',value:id[0],position}); i += id[0].length; continue; }
    const number = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/.exec(source.slice(i));
    if (number) { tokens.push({kind:'number',value:number[0],position}); i += number[0].length; continue; }
    if (source.startsWith('==', i)) { tokens.push({kind:'punct',value:'==',position}); i += 2; continue; }
    if (source.startsWith('&&', i)) { tokens.push({kind:'punct',value:'&&',position}); i += 2; continue; }
    if ('{}[]():=.@,?!'.includes(source[i])) { tokens.push({kind:'punct',value:source[i++],position}); continue; }
    fail('unsupported-token');
  }
  tokens.push({kind:'end',value:'',position:i}); return tokens;
}
export function parseExtendBicep(source: string): BicepProgram {
  const tokens = tokenize(source); let i = 0; let nodes = 0;
  const peek = () => tokens[i];
  const fail = (code: string): never => { throw new ExtendBicepError(code, peek().position); };
  const take = (value: string) => { if (peek().value !== value) fail(`expected-${value}`); return tokens[i++]; };
  const read = (kind: Token['kind']) => { if (peek().kind !== kind) fail(`expected-${kind}`); return tokens[i++].value; };
  function value(depth = 0,property?:string): BicepValue {
    if (depth > 32 || ++nodes > 8000) fail('expression-limit');
    if (peek().value === '{') {
      take('{'); const properties: Record<string, BicepValue> = Object.create(null);
      while (peek().value !== '}') {
        const key = read('id'); if (Object.hasOwn(properties,key)) fail('duplicate-property');
        take(':'); properties[key] = value(depth + 1,key);
      }
      take('}'); return {kind:'object',properties};
    }
    if (peek().value === '[') {
      take('['); const result: BicepValue[] = [];
      while (peek().value !== ']') result.push(value(depth + 1));
      take(']'); return result;
    }
    if (peek().kind === 'string') return read('string');
    if (peek().kind === 'number') { const n = Number(read('number')); if (!Number.isFinite(n)) fail('invalid-number'); return n; }
    const symbol = read('id');
    if((symbol==='deploymentTargetMatches'||symbol==='deploymentEnabled')&&peek().value==='?'){
      take('?');const site=read('id');take('!');take('.');take('properties');take('.');take('defaultHostName');take(':');
      if(read('string')!=='')fail('empty-false-hostname-required');
      return {kind:'guarded-new-site-hostname',symbol:site,...(symbol==='deploymentEnabled'?{guard:'deploymentEnabled' as const}:{})};
    }
    if(symbol==='deploymentZones'&&peek().value==='['){
      take('[');const index=Number(read('number'));take(']');if(index!==0&&index!==1)fail('bounded-primary-standby-zone-index-required');
      return {kind:'deployment-zone',index:index as 0|1};
    }
    if (symbol === 'true' || symbol === 'false') return symbol === 'true';
    if (symbol === 'null') return null;
    if (peek().value === '(') {
      if(symbol==='json'&&property==='cpu'){
        take('(');const raw=read('string');take(')');const n=Number(raw);
        if(!Number.isFinite(n)||n<0.25||n>4||!Number.isInteger(n*4)||String(n)!==raw)fail('canonical-bounded-container-cpu-required');
        return {kind:'container-cpu',value:n};
      }
      if (symbol === 'subscription') { take('('); take(')'); take('.'); take('tenantId'); return {kind:'tenant-id'}; }
      if(symbol==='resourceId'){
        take('(');const type=read('string');take(',');const gatewayName=read('string');take(',');const childName=read('string');take(')');
        if(!gatewayChildTypes.has(type)||!gatewayName||!childName)fail('reviewed-gateway-child-id-required');
        return {kind:'gateway-child-id',type,gatewayName,childName};
      }
      if (symbol !== 'resourceGroup') fail('function-not-supported');
      take('('); const subscription = read('string'); take(','); const group = read('string'); take(')');
      return {kind:'call',name:'resourceGroup',arguments:[subscription,group]};
    }
    if (peek().value === '.') {
      take('.'); const property = read('id'); if (property !== 'id' && property !== 'name') fail('reference-property-not-supported');
      return {kind:'reference',symbol,property:property as 'id'|'name'};
    }
    return {kind:'reference',symbol};
  }
  const program: BicepProgram = {parameters:[],resources:[]}; const names = new Set<string>();
  const name = () => { const n = read('id'); if (names.has(n)) fail('duplicate-symbol'); names.add(n); return n; };
  while (peek().kind !== 'end') {
    let secure = false; let description: string | undefined;let allowed:string[]|undefined;const bounds=new Map<string,number>();
    while (peek().value === '@') {
      take('@'); const decorator = read('id'); take('(');
      if (decorator === 'secure' && !secure) secure = true;
      else if (decorator === 'description' && description === undefined) description = read('string');
      else if(decorator==='allowed'&&allowed===undefined){take('[');allowed=[read('string')];while(peek().value===','){take(',');allowed.push(read('string'));}take(']');}
      else if(['minValue','maxValue','minLength','maxLength'].includes(decorator)&&!bounds.has(decorator))bounds.set(decorator,Number(read('number')));
      else fail('unsupported-decorator');
      take(')');
    }
    const keyword = read('id');
    if (keyword === 'var' && !secure && description === undefined&&!bounds.size&&!allowed) {
      if(peek().value==='deploymentInputsValid'){
        if(program.zoneInputGuard)fail('duplicate-input-guard');
        take('deploymentInputsValid');take('=');take('length');take('(');take('union');take('(');take('deploymentZones');take(',');take('deploymentZones');take(')');take(')');take('==');take('length');take('(');take('deploymentZones');take(')');
        take('var');take('deploymentEnabled');take('=');take('deploymentTargetMatches');take('&&');take('deploymentInputsValid');program.zoneInputGuard=true;continue;
      }
      take('deploymentTargetMatches'); if (program.deploymentTarget !== undefined) fail('duplicate-target');
      take('='); take('toLower'); take('('); take('resourceGroup'); take('('); take(')'); take('.'); take('id'); take(')'); take('==');
      program.deploymentTarget = read('string');
    } else if (keyword === 'output' && !secure && description === undefined&&!bounds.size&&!allowed) {
      take('deploymentTargetMatched'); take('bool'); take('='); take('deploymentTargetMatches');
      if (program.targetOutput) fail('duplicate-target-output'); program.targetOutput = true;
    } else if (keyword === 'param') {
      const n = name(),type=read('id'),base={name:n,...(description===undefined?{}:{description})};
      if(peek().value==='=')fail('parameter-default-not-supported');
      if(type==='string'&&secure&&!bounds.size&&!allowed)program.parameters.push({...base,secure:true});
      else if(type==='int'&&!secure&&!allowed&&bounds.size===2&&bounds.get('minValue')===1&&bounds.get('maxValue')===65535)
        program.parameters.push({...base,type:'int',minimum:1,maximum:65535});
      else if(type==='string'&&!secure&&!allowed&&bounds.size===2&&bounds.get('minLength')===1&&bounds.get('maxLength')===80)
        program.parameters.push({...base,type:'string',minLength:1,maxLength:80});
      else if(type==='array'&&n==='deploymentZones'&&!secure&&bounds.size===2&&bounds.get('minLength')===2&&bounds.get('maxLength')===3&&JSON.stringify(allowed)===JSON.stringify(['1','2','3']))
        program.parameters.push({...base,type:'array',minLength:2,maxLength:3,allowed:['1','2','3']});
      else fail('secure-secret-or-bounded-deployment-input-required');
    } else if (keyword === 'resource' && !secure && description === undefined&&!bounds.size&&!allowed) {
      const symbol = name(); const type = read('string');
      if (!/^Microsoft\.[A-Za-z0-9.]+(?:\/[A-Za-z][A-Za-z0-9]*)+@\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(type)) fail('full-resource-type-and-api-version-required');
      const existing = peek().value === 'existing'; if (existing) take('existing'); take('='); let guarded: BicepResource['guarded'];
      if (peek().value === 'if') { take('if'); take('(');if(peek().value==='deploymentEnabled'){take('deploymentEnabled');guarded='deploymentEnabled';}else{take('deploymentTargetMatches');guarded=true;}take(')'); }
      const body = value();
      if (body === null || typeof body !== 'object' || Array.isArray(body) || body.kind !== 'object') fail('resource-body-object-required');
      program.resources.push({symbol,type,existing,...(guarded ? {guarded} : {}),body:body as BicepObject});
    } else fail('unsupported-declaration-use-param-or-resource');
    if (program.resources.length > 200 || program.parameters.length > 40) fail('declaration-limit');
  }
  if (!program.resources.length) fail('resource-required'); return program;
}
const quote = (v: string) => "'" + v.replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\r','\\r').replaceAll('\n','\\n').replaceAll('\t','\\t').replaceAll('${','\\${') + "'";
export function emitBicepValue(value: BicepValue, depth = 0): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(v => emitBicepValue(v, depth+1)).join('\n')}]`;
  if (value.kind === 'tenant-id') return 'subscription().tenantId';
  if(value.kind==='guarded-new-site-hostname')return `${value.guard??'deploymentTargetMatches'} ? ${value.symbol}!.properties.defaultHostName : ''`;
  if(value.kind==='deployment-zone')return `deploymentZones[${value.index}]`;
  if(value.kind==='container-cpu')return `json(${quote(String(value.value))})`;
  if(value.kind==='gateway-child-id')return `resourceId(${quote(value.type)}, ${quote(value.gatewayName)}, ${quote(value.childName)})`;
  if (value.kind === 'reference') return value.symbol + (value.property ? `.${value.property}` : '');
  if (value.kind === 'call') return `resourceGroup(${quote(value.arguments[0])}, ${quote(value.arguments[1])})`;
  return `{\n${Object.entries(value.properties).map(([k,v]) => `${'  '.repeat(depth+1)}${k}: ${emitBicepValue(v,depth+1)}`).join('\n')}\n${'  '.repeat(depth)}}`;
}
export function emitExtendBicep(program: BicepProgram): string {
  return [...(program.deploymentTarget === undefined ? [] : [`var deploymentTargetMatches = toLower(resourceGroup().id) == ${quote(program.deploymentTarget)}`]), ...program.parameters.map(p =>
    `${'secure' in p?'@secure()':'type' in p&&p.type==='int'?`@minValue(${p.minimum})\n@maxValue(${p.maximum})`:`@minLength(${p.minLength})\n@maxLength(${p.maxLength})${p.type==='array'?`\n@allowed([${p.allowed.map(quote).join(', ')}])`:''}`}\n${p.description === undefined ? '' : `@description(${quote(p.description)})\n`}param ${p.name} ${'type' in p?p.type:'string'}`),
    ...(program.zoneInputGuard?['var deploymentInputsValid = length(union(deploymentZones, deploymentZones)) == length(deploymentZones)','var deploymentEnabled = deploymentTargetMatches && deploymentInputsValid']:[]),
    ...program.resources.map(r => `resource ${r.symbol} ${quote(r.type)} ${r.existing ? 'existing ' : ''}= ${r.guarded ? `if (${r.guarded==='deploymentEnabled'?'deploymentEnabled':'deploymentTargetMatches'}) ` : ''}${emitBicepValue(r.body)}`), ...(program.targetOutput ? ['output deploymentTargetMatched bool = deploymentTargetMatches'] : [])].join('\n\n') + '\n';
}
