import {useEffect,useState} from 'react';
import {api} from './api';
const sessionKey='window-review:subscription-login';
const names={openai:'OpenAI · Sign in with ChatGPT','openai-codex':'OpenAI Codex · 旧订阅入口',anthropic:'Claude · Pro / Max','github-copilot':'GitHub Copilot'};
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:undefined}catch{return undefined}};
export default function SubscriptionConfig({active,onActivate,run,busy}){
 const [providers,setProviders]=useState([]),[provider,setProvider]=useState('openai'),[model,setModel]=useState(''),[vision,setVision]=useState(''),[session,setSession]=useState(null),[sid,setSid]=useState(()=>sessionStorage.getItem(sessionKey)||''),[answer,setAnswer]=useState(''),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const selected=providers.find(p=>p.id===provider),pending=session?.status==='PENDING';
 async function refresh(){const data=await api('/subscriptions');setProviders(data.providers);setLoaded(true)}
 useEffect(()=>{refresh().catch(e=>{setError(e.message);setLoaded(true)})},[]);
 useEffect(()=>{if(active?.provider==='pi')setProvider(active.pi_provider)},[active?.provider,active?.pi_provider]);
 useEffect(()=>{
  const selected=providers.find(p=>p.id===provider);
  setModel(active?.provider==='pi'&&active.pi_provider===provider?active.model:selected?.models[0]?.id||'');
  setVision(active?.provider==='pi'&&active.pi_provider===provider?active.vision_model||'':'');
 },[provider,providers,active?.provider,active?.pi_provider,active?.model,active?.vision_model]);
 useEffect(()=>{
  if(!sid)return;
  let stopped=false,timer;
  async function poll(){
   try{
    const next=await api('/subscriptions/sessions/'+sid);
    if(stopped)return;
    setSession(next);
    if(next.status==='PENDING'){setProvider(next.provider);timer=setTimeout(poll,1500)}
    else {sessionStorage.removeItem(sessionKey);if(next.status==='AUTHORIZED')refresh().catch(e=>setError(e.message))}
   }catch(e){if(!stopped){setError(e.message);sessionStorage.removeItem(sessionKey)}}
  }
  poll();return()=>{stopped=true;clearTimeout(timer)};
 },[sid]);
 useEffect(()=>{setAnswer('')},[session?.prompt?.id]);
 async function login(){
  setError('');setAnswer('');
  const next=await api('/subscriptions/login',{provider});
  setSession(next);setSid(next.id);sessionStorage.setItem(sessionKey,next.id);
 }
 const prompt=session?.prompt;
 return <div className="settings-row subscription-config"><h3>模型订阅接入</h3><p>使用订阅账号授权登录。原有 API 配置会保留；点击「启用订阅模型」后，文本问答和已配置的视觉分析使用所选账号。</p>
 <div className="settings-grid"><label className="field">订阅服务<select aria-label="订阅服务" disabled={busy||pending} value={provider} onChange={e=>setProvider(e.target.value)}>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><div className="field">授权状态<span className="subscription-state">{!loaded?'读取中…':selected?.authorized?'已授权 · 凭据保存在本机':'未授权'}</span></div>
 <label className="field">订阅文本模型<select aria-label="订阅文本模型" disabled={!selected||busy} value={model} onChange={e=>setModel(e.target.value)}>{!selected?.models.length?<option value="">暂无模型目录</option>:null}{selected?.models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></label>
 <label className="field">订阅视觉模型<select aria-label="订阅视觉模型" disabled={!selected||busy} value={vision} onChange={e=>setVision(e.target.value)}><option value="">暂不启用视觉分析</option>{selected?.models.filter(m=>m.vision).map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></label></div>
 <p className="muted">目录来自 pi-ai 1.3.0，包含模型的图像输入能力；账号实际可用模型、订阅额度与地区限制以服务商和真实连接测试为准。</p>
 <div className="actions"><button disabled={busy||pending||!selected} onClick={()=>run(login)}>{selected?.authorized?'重新授权':'登录订阅账号'}</button><button className="primary" disabled={busy||pending||!selected?.authorized||!model} onClick={()=>run(async()=>onActivate(await api('/settings',{provider:'pi',pi_provider:provider,model,vision_model:vision})),'订阅模型已启用；原 API 配置仍保留。')}>启用订阅模型</button><button disabled={busy||pending||!selected?.authorized} onClick={()=>run(async()=>{await api('/subscriptions/'+provider+'/disconnect',{});await refresh();onActivate(await api('/settings'))},'已删除本机授权凭据。需要时可重新登录。')}>断开账号</button><button disabled={busy} onClick={()=>run(refresh)}>刷新目录与状态</button></div>
 {error?<p role="alert" className="notice">{error}</p>:null}
 {session?<div className="notice subscription-session" role="status"><b>授权进度 · {session.status==='PENDING'?'等待授权':session.status==='AUTHORIZED'?'授权完成，请选择模型并启用':session.status==='CANCELLED'?'已取消':'未完成'}</b>
 {session.status==='PENDING'?<><p>在服务商页面登录并授权；如提示填写授权码或回调地址，请在下方提交。无需在本项目输入账号密码。</p>{session.events.map((event,i)=><div key={i}>{event.type==='auth_url'?<p><a href={safeLink(event.url)} target="_blank" rel="noreferrer">打开服务商授权页面 ↗</a>{event.instructions?<small>{event.instructions}</small>:null}</p>:event.type==='device_code'?<p>设备授权码：<strong>{event.userCode}</strong> · <a href={safeLink(event.verificationUri)} target="_blank" rel="noreferrer">打开设备登录页面 ↗</a></p>:<p>{event.message}{event.links?.map(link=><a key={link.url} href={safeLink(link.url)} target="_blank" rel="noreferrer"> {link.label||'查看说明'} ↗</a>)}</p>}</div>)}
 {prompt?<form onSubmit={e=>{e.preventDefault();run(async()=>{setSession(await api('/subscriptions/sessions/'+sid+'/reply',{prompt_id:prompt.id,value:answer}));setAnswer('')})}}><label className="field">{prompt.message}{prompt.type==='select'?<select aria-label="授权选项" value={answer} onChange={e=>setAnswer(e.target.value)}><option value="">请选择</option>{prompt.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>:<input aria-label="授权码或回调地址" type="password" autoComplete="off" value={answer} maxLength={8192} placeholder={prompt.placeholder||'粘贴授权码或完整回调地址'} onChange={e=>setAnswer(e.target.value)}/>}</label><button disabled={busy||!answer.trim()} type="submit">提交授权信息</button></form>:null}<button disabled={busy} onClick={()=>run(async()=>{setSession(await api('/subscriptions/sessions/'+sid+'/cancel',{}));sessionStorage.removeItem(sessionKey)})}>取消本次登录</button></>:null}
 {session.error?<p>{session.error}</p>:null}</div>:null}
 <p className="muted">授权由 pi-ai 的服务商流程处理；令牌在当前 Windows 账号下加密保存，调用时自动刷新。断开账号会删除本机凭据；服务商端的授权可在其账号页面撤销。</p></div>
}
