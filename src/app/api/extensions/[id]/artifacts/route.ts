import {after} from 'next/server';
import {extensionArtifactApi} from '@/services/extension-artifact-api';
export const maxDuration=300;
type Context={params:Promise<{id:string}>};
export async function POST(request:Request,context:Context):Promise<Response>{
 return extensionArtifactApi(task=>after(task)).post(request,(await context.params).id);
}
export async function GET(request:Request,context:Context):Promise<Response>{
 return extensionArtifactApi(task=>after(task)).get((await context.params).id,new URL(request.url).searchParams.get('tier'));
}
