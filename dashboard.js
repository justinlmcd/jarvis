// JARVIS command center: the panels, the core, the clock and the bottom bar. Every number is real: your apps'
// tables (read as you, through row security), today's calendar from /api/today, and your conversation with Jarvis.
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S=window.youSettings, J=window.J;
const zone=()=>S?S.zone():Intl.DateTimeFormat().resolvedOptions().timeZone;
const today=()=>S?S.dayOf(Date.now()):new Date().toISOString().slice(0,10);
const addDays=(s,n)=>{ const d=new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const dayOf=ts=>S?S.dayOf(ts):String(ts).slice(0,10);
const r1=n=>{ const v=Math.round(n*10)/10; return Number.isInteger(v)?String(v):v.toFixed(1); };
const hm=m=>{ m=Math.round(m||0); return `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`; };
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n<100?2:0}).format(n);
const weekday=s=>new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'});
const APPS=[['body','BODY'],['money','MONEY'],['gym','GYM'],['meal','MEAL'],['write','WRITE'],['read','READ'],['sleep','SLEEP']];
let D=null, T=null, loading=false;

// ---- clock ----
function tick(){
  const now=new Date(), z=zone();
  $('date').textContent=now.toLocaleDateString('en-US',{timeZone:z,weekday:'long',day:'numeric',month:'long',year:'numeric'});
  $('time').textContent=now.toLocaleTimeString('en-US',{timeZone:z,hour:'numeric',minute:'2-digit',second:'2-digit'});
  if(T&&now.getSeconds()===0) renderTimeline();
}
tick(); setInterval(tick,1000);

// ---- the core: a turning sphere of points with two orbits; faster while thinking, pulsing while listening ----
(function core(){
  const canvas=$('core'), ctx=canvas.getContext('2d'), still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N=720, pts=[]; for(let i=0;i<N;i++){ const y=1-(i/(N-1))*2, r=Math.sqrt(1-y*y), th=i*Math.PI*(3-Math.sqrt(5)); pts.push([Math.cos(th)*r,y,Math.sin(th)*r]); }
  let mode='idle', angle=0, t=0, w=0, h=0, dpr=1;
  J.on('state',s=>{ mode=s; });
  const size=()=>{ dpr=Math.min(2,devicePixelRatio||1); const b=canvas.getBoundingClientRect(); w=b.width; h=b.height; canvas.width=w*dpr; canvas.height=h*dpr; };
  new ResizeObserver(size).observe(canvas); size();
  function frame(){
    const speed={idle:.0035,thinking:.02,listening:.006,speaking:.008}[mode]||.0035;
    angle+=still?0:speed; t+=still?0:1;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    const cx=w/2, cy=h/2, pulse=mode==='listening'?1+.05*Math.sin(t/6):mode==='speaking'?1+.03*Math.sin(t/4):1, R=Math.min(w,h)*.34*pulse;
    const g=ctx.createRadialGradient(cx,cy,R*.1,cx,cy,R*1.5); g.addColorStop(0,'rgba(47,216,255,.22)'); g.addColorStop(.6,'rgba(15,120,170,.08)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,R*1.5,0,Math.PI*2); ctx.fill();
    // orbits
    for(const [rx,ry,rot,dir] of [[1.55,.32,-.18,1],[1.35,.5,.35,-1]]){
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(rot); ctx.strokeStyle='rgba(47,216,255,.18)'; ctx.lineWidth=1; ctx.beginPath(); ctx.ellipse(0,0,R*rx,R*ry,0,0,Math.PI*2); ctx.stroke();
      for(let k=0;k<3;k++){ const a=dir*angle*2.2+k*2.1; ctx.fillStyle='rgba(160,240,255,.9)'; ctx.shadowColor='#2fd8ff'; ctx.shadowBlur=10; ctx.beginPath(); ctx.arc(Math.cos(a)*R*rx,Math.sin(a)*R*ry,1.8,0,Math.PI*2); ctx.fill(); }
      ctx.restore(); ctx.shadowBlur=0;
    }
    // sphere
    const ca=Math.cos(angle), sa=Math.sin(angle), tilt=.35, ct=Math.cos(tilt), st=Math.sin(tilt);
    for(const [x,y,z] of pts){
      const x1=x*ca+z*sa, z1=-x*sa+z*ca, y1=y*ct-z1*st, z2=y*st+z1*ct, depth=(z2+1)/2;
      ctx.fillStyle=`rgba(${120+90*depth|0},${220+30*depth|0},255,${.12+.75*depth})`;
      ctx.fillRect(cx+x1*R,cy+y1*R,.6+1.6*depth,.6+1.6*depth);
    }
    ctx.strokeStyle='rgba(47,216,255,.35)'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(cx,cy,R*1.02,0,Math.PI*2); ctx.stroke();
    if(!still) requestAnimationFrame(frame);
  }
  frame(); if(still) new ResizeObserver(()=>requestAnimationFrame(frame)).observe(canvas);
})();

// ---- data ----
async function rows(db,table,cols,f=q=>q){ try{ const {data,error}=await f(db.from(table).select(cols)).limit(2000); if(error) throw error; return data||[]; }catch{ return null; } }
async function one(db,table,cols){ try{ const {data,error}=await db.from(table).select(cols).maybeSingle(); if(error) throw error; return data; }catch{ return null; } }
async function load(){
  if(!J.user()||loading) return; loading=true;
  try{
    const db=await J.connect(), t=today(), since=addDays(t,-29);
    const [weights,tx,subs,profile,sets,cardio,meals,mealGoal,journal,pages,nights,sleepGoal,reviews,msgs,info]=await Promise.all([
      rows(db,'events','value,unit,occurred_at',q=>q.eq('metric','weight').gte('occurred_at',since+'T00:00:00Z').order('occurred_at',{ascending:false})),
      rows(db,'transactions','occurred_on,amount',q=>q.gte('occurred_on',since)),
      rows(db,'subscriptions','name,amount,next_charge,active',q=>q.eq('active',true)),
      one(db,'money_profile','budget'),
      rows(db,'sets','performed_on',q=>q.gte('performed_on',since)),
      rows(db,'cardio','performed_on,minutes',q=>q.gte('performed_on',since)),
      rows(db,'meal_entries','eaten_on,calories',q=>q.gte('eaten_on',since)),
      one(db,'meal_goals','calories'),
      rows(db,'journal_entries','written_on,rating',q=>q.gte('written_on',since)),
      rows(db,'reading_log','read_on,pages',q=>q.gte('read_on',since)),
      rows(db,'sleep_nights','night,asleep_min',q=>q.gte('night',since).order('night',{ascending:false})),
      one(db,'sleep_goals','goal_hours'),
      rows(db,'weekly_reviews','week_start,source,created_at',q=>q.gte('week_start',addDays(t,-6))),
      rows(db,'jarvis_messages','role,actions,created_at',q=>q.order('created_at',{ascending:false})),
      J.token().then(tok=>fetch('/api/today',{headers:{Authorization:'Bearer '+tok},cache:'no-store'})).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    D={t,weights,tx,subs,profile,sets,cardio,meals,mealGoal,journal,pages,nights,sleepGoal,reviews,msgs}; T=info;
    render();
  }finally{ loading=false; }
}

// Each app: a value for today, whether it's logged, a 7-day line and its streak.
function appStats(){
  const t=D.t, week=Array.from({length:7},(_,i)=>addDays(t,i-6)), sum=(list,key,val)=>{ const m={}; for(const r of list||[]) m[r[key]]=(m[r[key]]||0)+Number(val(r)); return m; };
  const U=S?.get().weight||'lbs', toU=(v,u)=>{ const f=String(u||'lbs').toLowerCase().startsWith('k')?'kg':'lbs'; v=Number(v); return f===U?v:U==='kg'?v*.45359237:v/.45359237; };
  const out={};
  if(D.weights){ const byDay={}; for(const r of [...D.weights].reverse()) byDay[dayOf(r.occurred_at)]=toU(r.value,r.unit); const last=D.weights[0];
    out.body={value:last?`${r1(toU(last.value,last.unit))} ${U}`:'—',note:last?(dayOf(last.occurred_at)===t?'weighed today':`last ${dayOf(last.occurred_at).slice(5)}`):'no weigh-ins',days:Object.keys(byDay),series:week.map(d=>byDay[d]??null)}; }
  if(D.tx){ const byDay=sum(D.tx,'occurred_on',r=>r.amount); const mStart=t.slice(0,8)+'01', month=D.tx.filter(r=>r.occurred_on>=mStart).reduce((a,r)=>a+Number(r.amount),0);
    out.money={value:money(byDay[t]||0),note:`${money(month)} this month`,days:Object.keys(byDay),series:week.map(d=>byDay[d]||0)}; }
  if(D.sets){ const byDay=sum(D.sets,'performed_on',()=>1), c=sum(D.cardio||[],'performed_on',r=>r.minutes); const days=[...new Set([...Object.keys(byDay),...Object.keys(c)])];
    const wk=days.filter(d=>d>=week[0]).length; out.gym={value:`${wk} workout${wk===1?'':'s'}`,note:`this week · ${byDay[t]?`${byDay[t]} sets today`:c[t]?`${Math.round(c[t])} min cardio`:'none today'}`,days,series:week.map(d=>(byDay[d]||0)+(c[d]?1:0))}; }
  if(D.meals){ const byDay=sum(D.meals,'eaten_on',r=>r.calories), goal=Number(D.mealGoal?.calories)||2000;
    out.meal={value:`${Math.round(byDay[t]||0).toLocaleString()} kcal`,note:`of ${goal.toLocaleString()} goal`,days:Object.keys(byDay),series:week.map(d=>byDay[d]||0),today:byDay[t]||0,goal}; }
  if(D.journal){ const byDay=Object.fromEntries(D.journal.map(r=>[r.written_on,r.rating]));
    out.write={value:byDay[t]?`${byDay[t]}/10`:'—',note:byDay[t]?'today rated':'not rated today',days:Object.keys(byDay),series:week.map(d=>byDay[d]??null)}; }
  if(D.pages){ const byDay=sum(D.pages,'read_on',r=>r.pages);
    out.read={value:`${byDay[t]||0} pages`,note:`${week.reduce((a,d)=>a+(byDay[d]||0),0)} this week`,days:Object.keys(byDay),series:week.map(d=>byDay[d]||0)}; }
  if(D.nights){ const byDay=Object.fromEntries(D.nights.map(n=>[n.night,n.asleep_min])), goal=(Number(D.sleepGoal?.goal_hours)||8)*60, last=D.nights[0];
    out.sleep={value:last?hm(last.asleep_min):'—',note:last?(last.night===t?'last night':`night of ${last.night.slice(5)}`):'no nights yet',days:Object.keys(byDay),series:week.map(d=>byDay[d]??null),last:last?.night===t?last.asleep_min:null,goal}; }
  for(const [k,s] of Object.entries(out)){ const has=new Set(s.days); s.logged=has.has(t); let d=s.logged?t:addDays(t,-1), n=0; while(has.has(d)&&n<60){ n++; d=addDays(d,-1); } s.streak=n; }
  return out;
}
function spark(series){
  const vals=series.filter(v=>v!=null); if(!vals.length) return '<svg viewBox="0 0 100 20" aria-hidden="true"><line x1="0" y1="18" x2="100" y2="18" stroke="currentColor" stroke-opacity=".2"/></svg>';
  const lo=Math.min(...vals), hi=Math.max(...vals), y=v=>hi===lo?10:18-((v-lo)/(hi-lo))*16;
  let d='', pen=false; series.forEach((v,i)=>{ if(v==null){ pen=false; return; } d+=`${pen?'L':'M'}${(i/6*100).toFixed(1)} ${y(v).toFixed(1)} `; pen=true; });
  const dots=series.map((v,i)=>v==null?'':`<circle cx="${(i/6*100).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.6" fill="var(--c)"/>`).join('');
  return `<svg viewBox="-2 0 104 20" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--c)" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-opacity=".9"/>${dots}</svg>`;
}

// ---- render ----
const ICON={core:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',
  mem:'<svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="2.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" stroke="currentColor" stroke-width="1.6"/></svg>',
  mic:'<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3.5" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke="currentColor" stroke-width="1.6"/></svg>',
  apps:'<svg viewBox="0 0 24 24" fill="none"><circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="7" r="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="17" r="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="17" r="2.5" stroke="currentColor" stroke-width="1.6"/></svg>',
  notion:'<svg viewBox="0 0 24 24" fill="none"><path d="M5 4.5h11l3 3v12H5z" stroke="currentColor" stroke-width="1.6"/><path d="M9 9v7M9 9l6 7M15 9v7" stroke="currentColor" stroke-width="1.4"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17" stroke="currentColor" stroke-width="1.6"/></svg>'};
function render(){
  const A=appStats(), t=D.t, connected=APPS.filter(([k])=>A[k]).length;
  // systems
  const msgCount=D.msgs?.length||0;
  const sys=[
    ['core','AI Core',T?.claude?['Active','ok']:T?['No API key','bad']:['Unreachable','bad']],
    ['mem','Memory',D.msgs?[`${msgCount.toLocaleString()} messages`,'ok']:['Not set up','off']],
    ['mic','Voice',J.canListen()?['Online','ok']:['Typing only','mid']],
    ['apps','Your apps',[`${connected} of 7 online`,connected===7?'ok':'mid']],
    ['notion','Notion',T?.notion?['Connected','ok']:['Not connected','off']],
    ['cal','Calendar',T?.calendar_error?['Error','bad']:T?.calendar?['Connected','ok']:['Not connected','off']],
  ];
  $('systems').innerHTML=sys.map(([i,name,[txt,cls]])=>`<div><i>${ICON[i]}</i><span><b>${name}</b><small class="${cls}">${esc(txt)}</small></span></div>`).join('');
  const bad=sys.some(s=>s[2][1]==='bad'), partial=sys.some(s=>s[2][1]==='off'||s[2][1]==='mid');
  $('sys-state').textContent=bad?'Degraded':partial?'Online':'Optimal'; $('sys-pill').classList.toggle('warn',bad);
  // apps
  $('apps').innerHTML=APPS.map(([k,name])=>{ const s=A[k]; if(!s) return `<div class="app" style="--c:var(--app-${k})"><b>${name}</b><strong>—</strong><small class="off">not set up</small></div>`;
    return `<button type="button" class="app" style="--c:var(--app-${k})" data-ask="How is my ${name} looking this week?"><b>${name}</b><strong>${esc(s.value)}</strong><small class="${s.logged?'ok':'off'}">${s.logged?'● ':'○ '}${esc(s.note)}</small>${spark(s.series)}</button>`; }).join('');
  $('apps-note').textContent=`${APPS.filter(([k])=>A[k]?.logged).length} of ${connected} logged today`;
  // rings
  const ring=(pct,label,sub,color)=>{ const p=Math.max(0,Math.min(1,pct||0)), C=2*Math.PI*34;
    return `<div><svg viewBox="0 0 86 86" role="img" aria-label="${esc(label)} ${Math.round(p*100)}%"><circle cx="43" cy="43" r="34" fill="none" stroke="var(--line)" stroke-width="7"/><circle cx="43" cy="43" r="34" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C*p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 43 43)" style="filter:drop-shadow(0 0 4px ${color})"/><text x="43" y="48" text-anchor="middle">${Math.round(p*100)}%</text></svg><b>${esc(label)}</b><small>${esc(sub)}</small></div>`; };
  const loggedN=APPS.filter(([k])=>A[k]?.logged).length;
  $('rings').innerHTML=ring(loggedN/7,'Logged',`${loggedN} of 7 apps`,'var(--cyan)')
    +ring(A.meal?A.meal.today/A.meal.goal:0,'Calories',A.meal?`${Math.round(A.meal.today).toLocaleString()} of ${A.meal.goal.toLocaleString()}`:'MEAL not set up',A.meal&&A.meal.today>A.meal.goal?'var(--amber)':'var(--green)')
    +ring(A.sleep?.last!=null?A.sleep.last/A.sleep.goal:0,'Sleep',A.sleep?.last!=null?`${hm(A.sleep.last)} of ${hm(A.sleep.goal)}`:'no night yet','var(--purple)');
  // streaks
  const st=APPS.filter(([k])=>A[k]).map(([k,name])=>({k,name,n:A[k].streak,kept:A[k].logged})), best=st.reduce((a,s)=>s.n>(a?.n||0)?s:a,null);
  $('streaks').innerHTML=st.map(s=>`<div style="--c:var(--app-${s.k})"><b>${s.name}</b><strong>${s.n?`🔥 ${s.n}`:'—'}</strong><small class="${s.n&&!s.kept?'mid':''}">${!s.n?'start today':s.kept?'kept today':'log to keep it'}</small></div>`).join('')
    +(best?`<div class="best" style="--c:var(--cyan)"><b>BEST</b><strong>${best.n} days</strong><small>${best.name}</small></div>`:'');
  renderMemory(); renderTimeline(); renderFeed(A);
}
function renderMemory(){
  const msgs=D.msgs||[], logs=msgs.reduce((a,m)=>a+(Array.isArray(m.actions)?m.actions.length:0),0), days=new Set(msgs.map(m=>dayOf(m.created_at)));
  $('mem-stats').innerHTML=`<div><small>Messages</small><b>${msgs.length.toLocaleString()}</b></div><div><small>Things logged</small><b>${logs}</b></div><div><small>Days talked</small><b>${days.size}</b></div>`;
  $('nav-msgs').hidden=!msgs.length; $('nav-msgs').textContent=msgs.length>99?'99+':msgs.length;
  const t=D.t, counts=Array.from({length:14},(_,i)=>{ const d=addDays(t,i-13); return msgs.filter(m=>dayOf(m.created_at)===d).length; }), hi=Math.max(1,...counts);
  const pts=counts.map((c,i)=>[8+i*(184/13),96-(c/hi)*80,c]);
  $('constellation').innerHTML=`<path d="${pts.filter(p=>p[2]).map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="rgba(47,216,255,.35)" stroke-width="1"/>`
    +pts.map(([x,y,c])=>`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${c?2+Math.min(4,c/hi*4):1.2}" fill="${c?'#bff4ff':'rgba(47,216,255,.25)'}" ${c?'style="filter:drop-shadow(0 0 3px #2fd8ff)"':''}><title>${c} message${c===1?'':'s'}</title></circle>`).join('');
}
const fmtTime=iso=>new Date(iso).toLocaleTimeString('en-US',{timeZone:zone(),hour:'numeric',minute:'2-digit'});
const until=ms=>{ const m=Math.round(ms/60000); return m<60?`in ${m}m`:`in ${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`; };
function todaysEvents(){ if(!T?.events) return []; const t=D.t; return T.events.filter(e=>e.all_day?(e.start<=t&&e.end>t):dayOf(e.start)===t); }
function renderTimeline(){
  const list=$('timeline'), note=$('time-note');
  if(!T||!T.calendar){ note.textContent=''; list.innerHTML=`<li class="empty">${T?'Connect Google Calendar to see your day here.':'Calendar unavailable.'}</li>`; return; }
  if(T.calendar_error){ list.innerHTML=`<li class="empty">${esc(T.calendar_error)}</li>`; return; }
  const ev=todaysEvents(), now=Date.now(); note.textContent=ev.length?`${ev.length} event${ev.length===1?'':'s'}`:'';
  if(!ev.length){ list.innerHTML='<li class="empty">Nothing on the calendar today.</li>'; return; }
  list.innerHTML=ev.map(e=>{ if(e.all_day) return `<li><time>All day</time><a href="${esc(e.url)}" target="_blank" rel="noopener"><b>${esc(e.title)}</b></a><span></span></li>`;
    const s=Date.parse(e.start), en=Date.parse(e.end), cls=en<=now?'done':s<=now?'now':'', status=en<=now?'Done':s<=now?'Now':until(s-now);
    return `<li class="${cls}"><time>${fmtTime(e.start)}</time><a href="${esc(e.url)}" target="_blank" rel="noopener"><b>${esc(e.title)}</b></a><span>${status}</span></li>`; }).join('');
}
function renderFeed(A){
  const items=[], t=D.t, now=Date.now(), hour=Number(new Date().toLocaleString('en-US',{timeZone:zone(),hour:'numeric',hourCycle:'h23'}));
  const next=(T?.events||[]).filter(e=>!e.all_day&&Date.parse(e.start)>now).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0];
  if(next&&Date.parse(next.start)-now<6*3600000) items.push(['info','📅',`Next: ${next.title}`,`${fmtTime(next.start)} · ${until(Date.parse(next.start)-now)}${next.location?` · ${next.location}`:''}`,'What\'s on my calendar today?']);
  const missing=APPS.filter(([k])=>A[k]&&!A[k].logged&&k!=='sleep').map(([,n])=>n);
  if(missing.length&&hour>=12) items.push(['warn','✎',`${missing.length===1?missing[0]+' isn\'t':missing.slice(0,-1).join(', ')+' and '+missing.at(-1)+' aren\'t'} logged yet`,'Tell me and I\'ll log it.',null]);
  const risk=APPS.filter(([k])=>A[k]&&!A[k].logged&&A[k].streak>=2&&k!=='sleep').map(([k,n])=>({n,s:A[k].streak})).sort((a,b)=>b.s-a.s)[0];
  if(risk) items.push(['warn','🔥',`${risk.s}-day ${risk.n} streak at risk`,'It ends at midnight unless you log today.',null]);
  for(const s of (D.subs||[]).filter(x=>x.next_charge&&x.next_charge>=t&&x.next_charge<=addDays(t,3)).slice(0,2)) items.push(['tip','$',`${s.name} renews ${s.next_charge===t?'today':weekday(s.next_charge)}`,money(Number(s.amount)),'What subscriptions do I pay for, and which could I cut?']);
  if(A.sleep?.last!=null){ const diff=A.sleep.last-A.sleep.goal; items.push([diff<-30?'warn':'tip','☾',`You slept ${hm(A.sleep.last)}`,diff>=0?'At or above your goal.':`${hm(-diff)} under your goal.`,'How has my sleep been this week, and does it affect my workouts?']); }
  if(A.meal&&A.meal.today>A.meal.goal) items.push(['warn','🍽',`${Math.round(A.meal.today-A.meal.goal).toLocaleString()} kcal over today`,`Goal ${A.meal.goal.toLocaleString()} kcal.`,null]);
  const rev=(D.reviews||[]).find(r=>r.week_start===addDays(t,-((new Date(`${t}T12:00:00Z`).getUTCDay()+6)%7))||r.source==='auto');
  if(rev) items.push(['info','★','Your weekly review is ready','Written '+new Date(rev.created_at).toLocaleDateString('en-US',{weekday:'short',timeZone:zone()}),'Summarise my latest weekly review.']);
  if(!items.length) items.push(['tip','✓','All clear','Everything\'s logged and nothing is due.',null]);
  const TAG={info:'t-info',warn:'t-warn',tip:'t-tip'};
  $('feed').innerHTML=items.map(([kind,icon,title,sub,q])=>`<button type="button" ${q?`data-ask="${esc(q)}"`:'data-open'}><i>${icon}</i><div><b>${esc(title)}</b><small>${esc(sub)}</small></div><span class="tag ${TAG[kind]}">${kind}</span></button>`).join('');
  const warns=items.filter(i=>i[0]==='warn').length; $('bell-count').hidden=!warns; $('bell-count').textContent=warns;
}

// ---- buttons ----
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-ask]'); if(a){ J.ask(a.dataset.ask); return; }
  if(e.target.closest('[data-open]')){ J.openDrawer(); return; }
  if(e.target.closest('[data-brief]')){ J.brief(); return; }
  const p=e.target.closest('[data-prefill]'); if(p){ J.prefill(p.dataset.prefill); }
});
$('bell').onclick=()=>$('feed').scrollIntoView({behavior:'smooth',block:'center'});
$('focus').onclick=()=>{ const on=document.body.classList.toggle('focus'); $('focus').setAttribute('aria-pressed',String(on)); $('focus').textContent=on?'◉ Exit focus mode':'◎ Focus mode'; };

// ---- bottom bar: location (your time zone), weather (Open-Meteo, only after you ask), network ----
function place(){ $('loc').textContent=(zone().split('/').pop()||'').replace(/_/g,' '); }
const WX={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Drizzle',53:'Drizzle',55:'Drizzle',61:'Rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Snow',73:'Snow',75:'Heavy snow',77:'Snow',80:'Showers',81:'Showers',82:'Heavy showers',85:'Snow showers',86:'Snow showers',95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm'};
async function weather(coords){
  const f=S?.get().length!=='metric';
  try{ const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat.toFixed(2)}&longitude=${coords.lon.toFixed(2)}&current=temperature_2m,weather_code${f?'&temperature_unit=fahrenheit':''}`); const j=await r.json();
    $('wx').textContent=`${Math.round(j.current.temperature_2m)}°${f?'F':'C'} ${WX[j.current.weather_code]||''}`.trim(); }
  catch{ $('wx').textContent='Unavailable'; }
}
let coords=null; try{ coords=JSON.parse(localStorage.getItem('jarvis.coords')||'null'); }catch{}
if(coords) weather(coords);
$('weather').onclick=()=>{ if(coords){ weather(coords); return; } if(!navigator.geolocation){ $('wx').textContent='No location'; return; } $('wx').textContent='Locating…';
  navigator.geolocation.getCurrentPosition(p=>{ coords={lat:p.coords.latitude,lon:p.coords.longitude}; try{ localStorage.setItem('jarvis.coords',JSON.stringify(coords)); }catch{} weather(coords); },()=>{ $('wx').textContent='Location off'; },{maximumAge:3600000,timeout:10000}); };
function net(){ const c=navigator.connection; $('net').textContent=navigator.onLine?`Online${c?.effectiveType?` · ${c.effectiveType.toUpperCase()}`:''}`:'Offline'; $('net').className=navigator.onLine?'ok':'bad'; }
addEventListener('online',net); addEventListener('offline',net); net(); place();
S?.on?.(()=>{ place(); tick(); if(D) render(); });

// ---- refresh: on sign-in, after Jarvis logs something, when you come back to the window, and every 5 minutes ----
J.on('user',u=>{ if(u) load(); else { D=null; T=null; } });
J.on('logged',()=>load());
addEventListener('focus',()=>{ if(D&&Date.now()-(window.__last||0)>60000){ window.__last=Date.now(); load(); } });
setInterval(()=>{ if(!document.hidden) load(); },300000);
})();
