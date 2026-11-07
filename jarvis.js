// JARVIS. A chat with your apps: you ask or tell, /api/jarvis has Claude read and log as you, the answer comes back here.
// The conversation is kept in jarvis_messages so it follows you between devices.
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const APP_NAMES={body:'BODY',money:'MONEY',gym:'GYM',meal:'MEAL',write:'WRITE',read:'READ',sleep:'SLEEP',notion:'NOTION',calendar:'CALENDAR'};

let client=null,user=null,authSub=null,connecting=null,storageCleanup=null,busy=false,signingIn=false,loadId=0;

// ---- connection: the public Supabase settings and YOU's address come from /api/config ----
function projectConfig(v){
  const url=typeof v?.url==='string'?v.url.trim().replace(/\/$/,''):'', key=typeof v?.key==='string'?v.key.trim():'';
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('This page needs its Supabase connection set up in Vercel.');
  if(typeof v.home==='string'&&/^https?:\/\//.test(v.home)){ $('home-link').href=v.home; $('settings-link').href=v.home.replace(/\/+$/,'')+'/#settings'; }
  return {url,key};
}
for(const id of ['home-link','settings-link']) $(id).addEventListener('click',e=>{ if(e.currentTarget.getAttribute('href')==='#'){ e.preventDefault(); alert('Set URL_HOME in this project\'s Vercel environment variables to your YOU address, then redeploy.'); } });
async function connect(){
  if(client)return client; if(connecting)return connecting;
  connecting=(async()=>{ let r; try{ r=await fetch('/api/config',{cache:'no-store'}); }catch{ throw new Error('Could not connect. Check your internet connection and try again.'); }
    if(!r.ok) throw new Error('This page needs its Supabase connection set up in Vercel.'); return makeClient(projectConfig(await r.json())); })();
  try{ return await connecting; } finally{ connecting=null; }
}
function makeClient(config){
  if(!window.supabase) throw new Error('The connection library could not load. Reload the page.');
  const storageKey='jarvis.auth.'+new URL(config.url).hostname, storage=window.localStorage;
  authSub?.unsubscribe(); client?.auth.stopAutoRefresh(); storageCleanup?.();
  client=supabase.createClient(config.url,config.key,{auth:{storage,storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const mine=client;
  authSub=client.auth.onAuthStateChange((_e,session)=>{ setTimeout(()=>{ if(client!==mine)return; setUser(session&&storage.getItem(storageKey)?session.user:null); },0); }).data.subscription;
  const changed=e=>{ if(client===mine&&e.storageArea===storage&&(e.key===storageKey||e.key===null)&&e.newValue===null)setUser(null); };
  window.addEventListener('storage',changed); storageCleanup=()=>window.removeEventListener('storage',changed);
  return client;
}
function setUser(next){
  if(next?.id===user?.id)return;
  user=next; loadId++;
  $('connect-open').hidden=!!user; $('sign-out').hidden=!user; $('clear').hidden=!user;
  $('status').textContent=user?'Connected':'Not signed in'; $('status').classList.toggle('on',!!user);
  $('input').disabled=!user; $('send').disabled=!user; syncMic();
  $('hello-text').textContent=user?'Ask about anything in your apps, or tell me what you did and I\'ll log it.':'Sign in with your YOU login to start.';
  clearChat(); if(user){ window.youSettings?.sync(client); loadHistory(); }
}

// ---- the conversation ----
// Plain text with **bold** and "- " bullets, escaped first.
function format(text){
  const inline=s=>esc(s).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  const out=[]; let list=null;
  for(const line of String(text).split('\n')){
    const m=line.match(/^\s*[-•*]\s+(.*)/);
    if(m){ (list=list||[]).push(`<li>${inline(m[1])}</li>`); continue; }
    if(list){ out.push(`<ul>${list.join('')}</ul>`); list=null; }
    if(line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if(list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}
function bubble(role,text,actions=[],error=false){
  $('hello').hidden=true;
  const el=document.createElement('div'); el.className=`msg ${role==='user'?'me':'jarvis'}${error?' err':''}`;
  el.innerHTML=role==='user'?`<p>${esc(text).replace(/\n/g,'<br>')}</p>`:format(text);
  if(actions?.length) el.insertAdjacentHTML('beforeend',`<div class="logged" aria-label="Logged">${actions.map(a=>{ const inner=`<b>${esc(APP_NAMES[a.app]||a.app)}</b>${esc(a.text)}`, link=/^https:\/\/(((www|app)\.)?notion\.(so|com)|(www|calendar)\.google\.com)\//.test(a.url||''); return `<span style="--c:var(--app-${esc(a.app)})">${link?`<a href="${esc(a.url)}" target="_blank" rel="noopener">${inner} ↗</a>`:inner}</span>`; }).join('')}</div>`);
  $('chat').appendChild(el); scrollDown(); return el;
}
function clearChat(){ for(const el of [...$('chat').querySelectorAll('.msg,.typing')]) el.remove(); $('hello').hidden=false; }
const scrollDown=()=>{ const s=$('scroller'); s.scrollTop=s.scrollHeight; };
async function loadHistory(){
  const id=loadId;
  try{ const db=await connect(); const {data,error}=await db.from('jarvis_messages').select('role,text,actions').order('created_at',{ascending:false}).limit(60); if(error) throw error; if(id!==loadId) return;
    for(const m of (data||[]).reverse()) bubble(m.role,m.text,m.actions); }
  catch(err){ if(id===loadId&&!/does not exist|schema cache|could not find the table/i.test(err.message||'')) note(err.message||'Could not load the conversation.','error'); }
}
const note=(t,kind='')=>{ $('note').textContent=t; $('note').className='note'+(kind?' '+kind:''); };

async function send(text){
  text=text.trim(); if(!text||busy||!user) return;
  busy=true; $('send').disabled=true; note('');
  bubble('user',text); $('input').value=''; grow();
  const typing=document.createElement('div'); typing.className='typing'; typing.setAttribute('aria-label','Jarvis is thinking'); typing.innerHTML='<i></i><i></i><i></i>'; $('chat').appendChild(typing); scrollDown();
  try{
    const db=await connect(); const {data:{session}}=await db.auth.getSession(); if(!session) throw new Error('Sign in again.');
    const r=await fetch('/api/jarvis',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({message:text})});
    const j=await r.json().catch(()=>({}));
    typing.remove();
    if(!r.ok){ bubble('assistant',j.error||'Jarvis couldn\'t answer just now.',j.actions,true); return; }
    bubble('assistant',j.reply,j.actions); speak(j.reply);
  }catch(err){ typing.remove(); bubble('assistant',err.message||'Jarvis couldn\'t answer just now.',[],true); }
  finally{ busy=false; $('send').disabled=!user; $('input').focus(); }
}
$('ask').addEventListener('submit',e=>{ e.preventDefault(); send($('input').value); });
$('input').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); send($('input').value); } });
const grow=()=>{ const t=$('input'); t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,160)+'px'; };
$('input').addEventListener('input',grow);
$('chips').addEventListener('click',e=>{ const b=e.target.closest('.chip'); if(!b) return; if(!user){ $('connection-dialog').showModal(); return; } send(b.textContent); });
$('clear').onclick=async()=>{ if(!user||busy||!confirm('Clear the whole conversation? Jarvis forgets it too; nothing in your apps changes.')) return;
  try{ const db=await connect(); const {error}=await db.from('jarvis_messages').delete().eq('user_id',user.id); if(error) throw error; clearChat(); note('Cleared.'); }catch(err){ note(err.message||'Could not clear.','error'); } };

// ---- voice: speak a message (where the browser can), and hear answers ----
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let listening=null;
function syncMic(){ $('mic').hidden=!Recognition||!user; }
$('mic').onclick=()=>{
  if(listening){ listening.stop(); return; }
  const rec=new Recognition(); rec.lang=navigator.language||'en-US'; rec.interimResults=true; rec.maxAlternatives=1;
  let finalText='';
  rec.onresult=e=>{ let interim=''; for(let i=e.resultIndex;i<e.results.length;i++){ const t=e.results[i][0].transcript; if(e.results[i].isFinal) finalText+=t; else interim+=t; } $('input').value=(finalText+interim).trim(); grow(); };
  rec.onerror=e=>{ note(e.error==='not-allowed'?'Allow the microphone for this site to speak to Jarvis.':'Didn\'t catch that.','error'); };
  rec.onend=()=>{ listening=null; $('mic').classList.remove('listening'); $('mic').setAttribute('aria-label','Speak'); if(finalText.trim()) send(finalText); };
  listening=rec; $('mic').classList.add('listening'); $('mic').setAttribute('aria-label','Stop listening'); note('Listening…'); rec.start();
};
const SPEAK_KEY='jarvis.speak';
let speakOn=false; try{ speakOn=localStorage.getItem(SPEAK_KEY)==='1'; }catch{}
$('speak').setAttribute('aria-pressed',String(speakOn)); if(!('speechSynthesis' in window)) $('speak').hidden=true;
$('speak').onclick=()=>{ speakOn=!speakOn; $('speak').setAttribute('aria-pressed',String(speakOn)); try{ localStorage.setItem(SPEAK_KEY,speakOn?'1':'0'); }catch{} if(!speakOn) speechSynthesis.cancel(); };
function speak(text){ if(!speakOn||!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(String(text).replace(/\*\*/g,'').replace(/^\s*[-•*]\s+/gm,'')); u.rate=1.05; speechSynthesis.speak(u); }

// ---- sign in and out ----
$('connect-open').onclick=()=>{ $('connection-dialog').showModal(); $('email').focus(); };
$('connect-close').onclick=()=>{ if(!signingIn) $('connection-dialog').close(); };
$('connect-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(signingIn) return; signingIn=true; $('connect-submit').disabled=true; $('connect-message').textContent='Signing in…'; $('connect-message').className='message';
  try{ const db=await connect(); const {data,error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}); if(error) throw error; $('password').value=''; setUser(data.user); $('connection-dialog').close(); $('connect-message').textContent=''; }
  catch(err){ $('connect-message').textContent=err.message||'Could not sign in.'; $('connect-message').className='message error'; }
  finally{ signingIn=false; $('connect-submit').disabled=false; }
});
$('sign-out').onclick=async()=>{ if(!client) return; try{ await client.auth.signOut({scope:'local'}); }catch{} setUser(null); };

connect().catch(err=>note(err.message,'error'));
})();
