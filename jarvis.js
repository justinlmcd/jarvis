// JARVIS. Sign-in, the conversation drawer, voice and keyboard shortcuts. The dashboard (dashboard.js) uses window.J.
// You ask or tell; /api/jarvis has Claude read and log as you; the answer comes back in the drawer.
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const APP_NAMES={body:'BODY',money:'MONEY',gym:'GYM',meal:'MEAL',write:'WRITE',read:'READ',sleep:'SLEEP',notion:'NOTION',calendar:'CALENDAR'};
let client=null,user=null,authSub=null,connecting=null,storageCleanup=null,busy=false,signingIn=false,loadId=0,home='';
const listeners={};
const emit=(ev,v)=>(listeners[ev]||[]).forEach(f=>{ try{ f(v); }catch(e){ console.error(e); } });

// ---- connection: the public Supabase settings and YOU's address come from /api/config ----
function projectConfig(v){
  const url=typeof v?.url==='string'?v.url.trim().replace(/\/$/,''):'', key=typeof v?.key==='string'?v.key.trim():'';
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('This page needs its Supabase connection set up in Vercel.');
  if(typeof v.home==='string'&&/^https?:\/\//.test(v.home)){ home=v.home.replace(/\/+$/,''); $('home-link').href=home; $('settings-link').href=home+'/#settings'; }
  return {url,key};
}
for(const id of ['home-link','settings-link']) $(id).addEventListener('click',e=>{ if(e.currentTarget.getAttribute('href')==='#'){ e.preventDefault(); alert('Set URL_HOME in this project\'s Vercel environment variables to your YOU address, then redeploy.'); } });
async function connect(){
  if(client)return client; if(connecting)return connecting;
  connecting=(async()=>{ let r; try{ r=await fetch('/api/config',{cache:'no-store'}); }catch{ throw new Error('Could not connect. Check your internet connection.'); }
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
  if(!storage.getItem(storageKey)) setTimeout(()=>{ if(!user) $('gate').hidden=false; },300);
  return client;
}
function setUser(next){
  if(next?.id===user?.id&&next!==undefined)return;
  user=next||null; loadId++;
  $('connect-open').hidden=!!user; $('sign-out').hidden=!user; $('gate').hidden=!!user;
  $('who-sub').textContent=user?(user.email||'Signed in'):'Not signed in'; $('avatar').textContent=(user?.email||'J')[0].toUpperCase();
  clearChat(); if(user){ window.youSettings?.sync(client); loadHistory(); setTimeout(startWake,800); } else stopWake();
  emit('user',user);
}
async function token(){ const db=await connect(); const {data:{session}}=await db.auth.getSession(); return session?.access_token||null; }

// ---- the drawer ----
function openDrawer(focus=true){ $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden','false'); $('scrim').hidden=false; document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('on',b.dataset.nav==='chat')); if(focus) setTimeout(()=>$('input').focus(),60); }
function closeDrawer(){ $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden','true'); $('scrim').hidden=true; document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('on',b.dataset.nav==='center')); }
$('drawer-close').onclick=closeDrawer; $('scrim').onclick=closeDrawer;
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>b.dataset.nav==='chat'?openDrawer():closeDrawer());

// ---- the conversation ----
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
const LINK=/^https:\/\/(((www|app)\.)?notion\.(so|com)|(www|calendar)\.google\.com)\//;
function bubble(role,text,actions=[],error=false){
  $('chat-hint').hidden=true;
  const el=document.createElement('div'); el.className=`msg ${role==='user'?'me':'jarvis'}${error?' err':''}`;
  el.innerHTML=role==='user'?`<p>${esc(text).replace(/\n/g,'<br>')}</p>`:format(text);
  if(actions?.length) el.insertAdjacentHTML('beforeend',`<div class="logged" aria-label="Logged">${actions.map(a=>{ const inner=`<b>${esc(APP_NAMES[a.app]||a.app)}</b>${esc(a.text)}`; return `<span style="--c:var(--app-${esc(a.app)})">${LINK.test(a.url||'')?`<a href="${esc(a.url)}" target="_blank" rel="noopener">${inner} ↗</a>`:inner}</span>`; }).join('')}</div>`);
  $('chat').appendChild(el); $('chat').scrollTop=$('chat').scrollHeight; return el;
}
function clearChat(){ for(const el of [...$('chat').querySelectorAll('.msg,.typing')]) el.remove(); $('chat-hint').hidden=false; }
async function loadHistory(){
  const id=loadId;
  try{ const db=await connect(); const {data,error}=await db.from('jarvis_messages').select('role,text,actions').order('created_at',{ascending:false}).limit(60); if(error) throw error; if(id!==loadId) return;
    for(const m of (data||[]).reverse()) if(m.text) bubble(m.role,m.text,m.actions); }
  catch(err){ if(id===loadId&&!/does not exist|schema cache|could not find the table/i.test(err.message||'')) note(err.message||'Could not load the conversation.','error'); }
}
const note=(t,kind='')=>{ $('note').textContent=t; $('note').className='note'+(kind?' '+kind:''); };
let voiceState='idle';
function state(s){ voiceState=s; emit('state',s); $('core-state').textContent={idle:'STANDING BY',thinking:'PROCESSING',listening:'LISTENING',speaking:'SPEAKING'}[s]||s; }

async function ask(text){
  text=String(text||'').trim(); if(!text) return;
  if(!user){ $('connection-dialog').showModal(); return; }
  openDrawer(false);
  if(busy){ note('One moment, still answering.'); return; }
  busy=true; $('send').disabled=true; note(''); state('thinking');
  bubble('user',text); $('input').value=''; grow();
  const typing=document.createElement('div'); typing.className='typing'; typing.setAttribute('aria-label','Jarvis is thinking'); typing.innerHTML='<i></i><i></i><i></i>'; $('chat').appendChild(typing); $('chat').scrollTop=$('chat').scrollHeight;
  try{
    const t=await token(); if(!t) throw new Error('Sign in again.');
    const r=await fetch('/api/jarvis',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({message:text})});
    const j=await r.json().catch(()=>({}));
    typing.remove();
    if(!r.ok){ bubble('assistant',j.error||'Jarvis couldn\'t answer just now.',j.actions,true); state('idle'); return; }
    bubble('assistant',j.reply,j.actions); speak(j.reply);
    if(j.actions?.length) emit('logged',j.actions);
  }catch(err){ typing.remove(); bubble('assistant',err.message||'Jarvis couldn\'t answer just now.',[],true); state('idle'); }
  finally{ busy=false; $('send').disabled=false; emit('answered'); }
}
$('ask').addEventListener('submit',e=>{ e.preventDefault(); ask($('input').value); });
$('input').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); ask($('input').value); } });
const grow=()=>{ const t=$('input'); t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,150)+'px'; };
$('input').addEventListener('input',grow);
$('search').addEventListener('submit',e=>{ e.preventDefault(); const v=$('search-input').value; $('search-input').value=''; $('search-input').blur(); ask(v); });
$('clear').onclick=async()=>{ if(!user||busy||!confirm('Clear the whole conversation? Jarvis forgets it too; nothing in your apps changes.')) return;
  try{ const db=await connect(); const {error}=await db.from('jarvis_messages').delete().eq('user_id',user.id); if(error) throw error; clearChat(); note('Cleared.'); emit('logged',[]); }catch(err){ note(err.message||'Could not clear.','error'); } };
function prefill(text){ if(!user){ $('connection-dialog').showModal(); return; } openDrawer(); $('input').value=text; grow(); const t=$('input'); t.focus(); t.setSelectionRange(text.length,text.length); }

// ---- voice: speak to Jarvis (Safari and Chrome on the Mac), and hear answers ----
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let listening=null;
function listen(){
  if(!user){ $('connection-dialog').showModal(); return; }
  if(listening){ listening.stop(); return; }
  stopWake();
  if(!Recognition){ note('This browser can\'t hear you. Use Safari or Chrome, or type.','error'); openDrawer(); return; }
  speechSynthesis?.cancel();
  const rec=new Recognition(); rec.lang=navigator.language||'en-US'; rec.interimResults=true; rec.maxAlternatives=1;
  let finalText='';
  rec.onresult=e=>{ let interim=''; for(let i=e.resultIndex;i<e.results.length;i++){ const t=e.results[i][0].transcript; if(e.results[i].isFinal) finalText+=t; else interim+=t; } $('voice-state').textContent=(finalText+interim).trim().slice(-60)||'Listening…'; $('talk-state').textContent='Listening…'; };
  rec.onerror=e=>{ note(e.error==='not-allowed'?'Allow the microphone for this site to talk to Jarvis.':'Didn\'t catch that.','error'); };
  rec.onend=()=>{ listening=null; setListening(false); if(finalText.trim()) ask(finalText); else state('idle'); };
  listening=rec; setListening(true); state('listening'); rec.start();
}
function setListening(on){
  for(const id of ['voice','talk']) $(id).classList.toggle('live',on); $('mic').classList.toggle('live',on);
  $('voice-state').textContent=on?'Listening…':idleText(); $('talk-state').textContent=on?'Listening… click to stop':idleTalk();
}
const idleText=()=>wakeOn&&wakeRec?'Say “Hey Jarvis”':'Ready';
const idleTalk=()=>wakeOn&&wakeRec?'Say “Hey Jarvis” or press ⌘J':'Press ⌘J or click';

// ---- "Hey Jarvis": while switched on, Jarvis keeps listening and acts only on what follows the wake phrase ----
// The browser's speech recognition does the hearing (Chrome: Google's service; Safari: Apple's), so it is off until
// you switch it on. It pauses while Jarvis thinks or speaks, so it never hears itself, and restarts when the browser
// stops it (Chrome does about once a minute).
const WAKE_KEY='jarvis.wake';
const WAKE=/\b(?:(?:hey|hi|ok|okay|yo)[\s,]+)?jarvis\b[\s,.!?]*/i;
let wakeOn=false, wakeRec=null, wakeRestart=null, armedUntil=0, wakeFails=0;
try{ wakeOn=localStorage.getItem(WAKE_KEY)==='1'; }catch{}
function chime(){ try{ const a=new (window.AudioContext||window.webkitAudioContext)(), t=a.currentTime;
  for(const [f,d] of [[660,0],[990,.09]]){ const o=a.createOscillator(), g=a.createGain(); o.frequency.value=f; o.type='sine'; g.gain.setValueAtTime(.0001,t+d); g.gain.exponentialRampToValueAtTime(.12,t+d+.02); g.gain.exponentialRampToValueAtTime(.0001,t+d+.16); o.connect(g).connect(a.destination); o.start(t+d); o.stop(t+d+.18); }
  setTimeout(()=>a.close(),600); }catch{} }
function syncWake(){
  const b=$('wake'); if(!b) return; b.hidden=!Recognition; b.setAttribute('aria-pressed',String(wakeOn));
  b.textContent=wakeOn?(wakeRec?'“Hey Jarvis” · On':'“Hey Jarvis” · On (paused)'):'“Hey Jarvis” · Off';
  $('voice').classList.toggle('wake',wakeOn&&!!wakeRec);
  if(!listening){ $('voice-state').textContent=armedUntil>Date.now()?'Yes, sir?':idleText(); $('talk-state').textContent=idleTalk(); }
}
function heard(cmd){ armedUntil=0; stopWake(); ask(cmd); }
function startWake(){
  clearTimeout(wakeRestart);
  if(!wakeOn||!user||!Recognition||wakeRec||listening||voiceState==='thinking'||voiceState==='speaking'||busy) return;
  const rec=new Recognition(); rec.lang=navigator.language||'en-US'; rec.continuous=true; rec.interimResults=true; rec.maxAlternatives=1;
  rec.onresult=e=>{ wakeFails=0;
    for(let i=e.resultIndex;i<e.results.length;i++){
      const r=e.results[i], text=r[0].transcript.trim(); if(!text) continue;
      if(armedUntil>Date.now()){ if(r.isFinal){ heard(text.replace(WAKE,'').trim()||text); return; } $('voice-state').textContent=text.slice(-60); continue; }
      const m=WAKE.exec(text); if(!m) continue;
      const rest=text.slice(m.index+m[0].length).trim();
      if(!r.isFinal){ $('voice-state').textContent='…'; continue; }
      if(rest.length>2){ chime(); heard(rest); return; }
      // Just the wake phrase: chime and wait for the request.
      chime(); armedUntil=Date.now()+8000; state('listening'); syncWake();
      setTimeout(()=>{ if(armedUntil&&armedUntil<=Date.now()){ armedUntil=0; if(voiceState==='listening') state('idle'); syncWake(); } },8100);
    }
  };
  rec.onerror=e=>{ if(e.error==='not-allowed'||e.error==='service-not-allowed'){ wakeFails=99; note('Allow the microphone for this site, then switch “Hey Jarvis” on again.','error'); setWake(false); }
    else if(e.error!=='no-speech'&&e.error!=='aborted') wakeFails++; };
  rec.onend=()=>{ if(wakeRec===rec) wakeRec=null; syncWake();
    if(wakeOn&&wakeFails<6) wakeRestart=setTimeout(startWake,wakeFails?Math.min(15000,1000*2**wakeFails):300);
    else if(wakeOn&&wakeFails>=6&&wakeFails<99) note('“Hey Jarvis” keeps stopping. Check your connection; it will try again when you click it.','error'); };
  try{ rec.start(); wakeRec=rec; }catch{ wakeRestart=setTimeout(startWake,1000); }
  syncWake();
}
function stopWake(){ clearTimeout(wakeRestart); const r=wakeRec; wakeRec=null; armedUntil=0; try{ r?.abort(); }catch{} syncWake(); }
function setWake(on){ wakeOn=on; try{ localStorage.setItem(WAKE_KEY,on?'1':'0'); }catch{} wakeFails=0; if(on) startWake(); else stopWake(); syncWake(); }
// Resume after Jarvis has answered (a moment after it stops speaking), and when the window comes back.
listeners.state=(listeners.state||[]).concat(s=>{ if(s==='thinking'||s==='speaking') stopWake(); else if(s==='idle'&&wakeOn) wakeRestart=setTimeout(startWake,700); });
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&wakeOn) startWake(); });
for(const id of ['mic','mic-big','talk','cmd-voice']) $(id).onclick=listen;
$('wake').onclick=()=>{ if(!user){ $('connection-dialog').showModal(); return; } wakeFails=0; setWake(!wakeOn||!wakeRec?true:false); };
syncWake();
const SPEAK_KEY='jarvis.speak';
let speakOn=true; try{ speakOn=localStorage.getItem(SPEAK_KEY)!=='0'; }catch{}
const syncSpeak=()=>$('speak').setAttribute('aria-pressed',String(speakOn)); syncSpeak();
if(!('speechSynthesis' in window)){ $('speak').hidden=true; speakOn=false; }
$('speak').onclick=()=>{ speakOn=!speakOn; syncSpeak(); try{ localStorage.setItem(SPEAK_KEY,speakOn?'1':'0'); }catch{} if(!speakOn){ speechSynthesis.cancel(); state('idle'); } };
// The voice: a British man, the best one this Mac has. Chrome's "Google UK English Male" first, then macOS's
// Daniel (Premium or Enhanced if you've downloaded them), then other UK male voices, then any UK English voice.
// Your pick in the conversation panel wins.
const VOICE_KEY='jarvis.voice';
const BRITISH=[/^Google UK English Male$/i,/^Daniel \(Premium\)/i,/^Daniel \(Enhanced\)/i,/^Daniel\b/i,/^Arthur\b/i,/^Oliver\b/i,/^Jamie\b/i,/^Malcolm\b/i,/^Microsoft (Ryan|George|Thomas|Alfie)/i];
const gb=v=>/^en[-_]GB/i.test(v.lang);
function voices(){ return 'speechSynthesis' in window?speechSynthesis.getVoices():[]; }
function bestVoice(){
  const all=voices(); let saved=''; try{ saved=localStorage.getItem(VOICE_KEY)||''; }catch{}
  if(saved){ const v=all.find(x=>x.name===saved); if(v) return v; }
  for(const re of BRITISH){ const v=all.find(x=>re.test(x.name)&&(gb(x)||/Google UK/i.test(x.name))); if(v) return v; }
  return all.find(gb)||all.find(v=>v.lang===(navigator.language||'en-US'))||null;
}
function fillVoices(){
  const sel=$('voice-pick'); if(!sel) return; const all=voices().filter(v=>/^en/i.test(v.lang)); if(!all.length){ sel.hidden=true; return; }
  const cur=bestVoice(); sel.hidden=false;
  const order=v=>{ const i=BRITISH.findIndex(re=>re.test(v.name)); return (i<0?BRITISH.length:i)+(gb(v)||/Google UK/i.test(v.name)?0:100); };
  sel.innerHTML=all.sort((a,b)=>order(a)-order(b)||a.name.localeCompare(b.name)).map(v=>`<option value="${esc(v.name)}"${v===cur?' selected':''}>${esc(v.name)}${gb(v)?' · UK':''}</option>`).join('');
}
if('speechSynthesis' in window){ fillVoices(); speechSynthesis.addEventListener?.('voiceschanged',fillVoices); }
$('voice-pick')?.addEventListener('change',e=>{ try{ localStorage.setItem(VOICE_KEY,e.target.value); }catch{} speakOn=true; syncSpeak(); speak('Good evening. Jarvis at your service.'); });
function speak(text){
  if(!speakOn||!('speechSynthesis' in window)){ state('idle'); return; }
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(String(text).replace(/\*\*/g,'').replace(/^\s*[-•*]\s+/gm,'').replace(/https?:\/\/\S+/g,''));
  const v=bestVoice(); if(v){ u.voice=v; u.lang=v.lang; }
  // Measured and a touch low: calm, not chirpy.
  u.rate=.96; u.pitch=.9;
  u.onstart=()=>state('speaking'); u.onend=u.onerror=()=>state('idle');
  speechSynthesis.speak(u);
}

// ---- keyboard: ⌘K ask, ⌘J talk, Esc close ----
document.addEventListener('keydown',e=>{
  const mod=e.metaKey||e.ctrlKey;
  if(mod&&e.key.toLowerCase()==='k'){ e.preventDefault(); if($('drawer').classList.contains('open')) $('input').focus(); else { $('search-input').focus(); } }
  else if(mod&&e.key.toLowerCase()==='j'){ e.preventDefault(); listen(); }
  else if(e.key==='Escape'&&$('drawer').classList.contains('open')&&!document.querySelector('dialog[open]')) closeDrawer();
});

// ---- sign in and out ----
const openSignIn=()=>{ $('connection-dialog').showModal(); $('email').focus(); };
$('connect-open').onclick=openSignIn; $('gate-signin').onclick=openSignIn;
$('connect-close').onclick=()=>{ if(!signingIn) $('connection-dialog').close(); };
$('connect-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(signingIn) return; signingIn=true; $('connect-submit').disabled=true; $('connect-message').textContent='Signing in…'; $('connect-message').className='message';
  try{ const db=await connect(); const {data,error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}); if(error) throw error; $('password').value=''; setUser(data.user); $('connection-dialog').close(); $('connect-message').textContent=''; }
  catch(err){ $('connect-message').textContent=err.message||'Could not sign in.'; $('connect-message').className='message error'; }
  finally{ signingIn=false; $('connect-submit').disabled=false; }
});
$('sign-out').onclick=async()=>{ if(!client) return; try{ await client.auth.signOut({scope:'local'}); }catch{} setUser(null); };

window.J={connect,token,ask,prefill,openDrawer,listen,on:(ev,f)=>(listeners[ev]=listeners[ev]||[]).push(f),user:()=>user,home:()=>home,canListen:()=>!!Recognition,
  brief:()=>ask('Give me my executive briefing: today\'s schedule, what I\'ve logged and what\'s left, last night\'s sleep, spending this week against my budget, how my goals are pacing, and anything I should know. Keep it tight.')};
connect().catch(err=>{ note(err.message,'error'); $('sys-state').textContent='Offline'; $('sys-pill').classList.add('warn'); });
})();
