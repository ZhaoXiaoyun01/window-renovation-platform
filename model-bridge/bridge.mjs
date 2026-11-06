// JSON-lines over local stdio only. Credentials never go to the browser or argv.
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {createModels} from '@earendil-works/pi-ai';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
import {openaiCodexProvider} from '@earendil-works/pi-ai/providers/openai-codex';
import {anthropicProvider} from '@earendil-works/pi-ai/providers/anthropic';
import {githubCopilotProvider} from '@earendil-works/pi-ai/providers/github-copilot';

const lines=createInterface({input:process.stdin});
lines.on('close',()=>process.exit(0));
const pending=new Map();
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
let begin;
const initial=new Promise(resolve=>{begin=resolve});
lines.on('line',line=>{
 const value=JSON.parse(line);
 if(begin){const resolve=begin;begin=null;resolve(value)}
 else {const item=pending.get(value.id);if(item){pending.delete(value.id);value.ok===false?item.reject(new Error('STORE_FAILED')):item.resolve(value.value)}}
});
function ask(value,signal){
 return new Promise((resolve,reject)=>{
  const id=randomUUID();
  const abort=()=>{pending.delete(id);emit({type:'prompt_cancelled',id});reject(new Error('CANCELLED'))};
  pending.set(id,{resolve:value=>{signal?.removeEventListener('abort',abort);resolve(value)},reject});
  if(signal?.aborted){abort();return}
  signal?.addEventListener('abort',abort,{once:true});
  emit({...value,id});
 });
}
try {
 const request=await initial;
 const values=request.credentials||{};
 const credentials={
  read:async id=>values[id],
  list:async()=>Object.entries(values).map(([providerId,c])=>({providerId,type:c.type})),
  modify:async(id,fn)=>{
   const next=await fn(values[id]);
   if(next!==undefined){await ask({type:'credential',provider:id,value:next});values[id]=next}
   return values[id];
  },
  delete:async id=>{await ask({type:'credential',provider:id,value:null});delete values[id]},
 };
 // Ignore ambient credentials: this app uses only accounts explicitly connected here.
 const models=createModels({credentials,authContext:{env:async()=>undefined,fileExists:async()=>false}});
 for(const factory of [openaiProvider,openaiCodexProvider,anthropicProvider,githubCopilotProvider])models.setProvider(factory());
 let result;
 if(request.action==='catalog'){
  result=models.getProviders().map(p=>({id:p.id,name:p.auth.oauth.name,models:(p.filterModels?.(p.getModels(),values[p.id])||p.getModels()).map(m=>({id:m.id,name:m.name,vision:m.input.includes('image')}))}));
 }else if(request.action==='login'){
  await models.login(request.provider,'oauth',{
   signal:AbortSignal.timeout(600000),
   notify:event=>emit({type:'event',event}),
   prompt:({signal,...prompt})=>ask({type:'prompt',prompt},signal),
  });
  result={status:'AUTHORIZED'};
 }else if(request.action==='complete'){
  if(!values[request.provider]){emit({type:'result',value:{status:'NOT_CONFIGURED',text:''}});process.exit(0)}
  const model=models.getModel(request.provider,request.model);
  if(!model){emit({type:'result',value:{status:'MODEL_NOT_FOUND',text:''}});process.exit(0)}
  const systemPrompt=request.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const messages=request.messages.filter(m=>m.role!=='system').map(m=>({role:m.role,timestamp:Date.now(),content:typeof m.content==='string'?m.content:m.content.map(item=>{
   if(item.type==='text')return item;
   const match=/^data:([^;]+);base64,(.+)$/s.exec(item.image_url.url);
   if(!match)throw new Error('INVALID_IMAGE');
   return {type:'image',mimeType:match[1],data:match[2]};
  })}));
  const response=await models.completeSimple(model,{systemPrompt,messages},{signal:AbortSignal.timeout(65000)});
  const text=response.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  result={status:['error','aborted'].includes(response.stopReason)?'PROVIDER_FAILED':text?'OK':'UNVERIFIED_RESPONSE',text:['error','aborted'].includes(response.stopReason)?'':text};
 }else throw new Error('INVALID_ACTION');
 emit({type:'result',value:result});
}catch(error){
 emit({type:'error',status:error?.code==='oauth'?'AUTH_FAILED':error?.message==='STORE_FAILED'?'STORE_FAILED':'PROVIDER_FAILED'});
}finally{process.exit(0)}
