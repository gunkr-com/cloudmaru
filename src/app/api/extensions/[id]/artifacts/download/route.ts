import {getLocale} from '@/i18n/server';
import {extensionArtifactApi} from '@/services/extension-artifact-api';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context):Promise<Response>{
 const params=new URL(request.url).searchParams;
 return extensionArtifactApi(()=>{throw Error('read-only');}).download((await context.params).id,params.get('tier'),params.get('kind'),await getLocale());
}
