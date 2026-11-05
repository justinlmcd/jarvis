// YOU settings: theme, accent, font, time zone, when your day ends, and units. The same file runs in every app.
// Loaded in <head> so the theme and font are applied before the page paints, from this device's copy.
// You change them in YOU's Settings tab, which saves them to your account (the user_settings table);
// each app reads them from there when you sign in (sync) and keeps a copy for next time.
// With data-accent="own" (every app but YOU) the app keeps its own colour instead of YOU's accent.
(function(){
'use strict';
const SCRIPT=document.currentScript, OWN_ACCENT=!!(SCRIPT&&SCRIPT.dataset.accent==='own');
const KEY='you.settings';
const DEFAULTS={theme:'system',accent:'stone',font:'default',timeZone:'',dayEnds:0,weight:'lbs',length:'imperial',reviewAuto:true,reviewHour:18};
// Each accent: its name, then the tone on dark and on light (darker, so it reads on a light page).
const ACCENTS={stone:['Stone','#ebe7df','#3a3833'],mint:['Mint','#9be3c0','#17805a'],sky:['Sky','#8fd3ff','#1d6fae'],lilac:['Lilac','#c9a7ff','#6b44c4'],peach:['Peach','#ffb88a','#b9521a'],rose:['Rose','#ff9fb8','#bd385e'],gold:['Gold','#ffd98a','#8a6200']};
// System fonts only: nothing to download, so the page stays fast. Each falls back where a device lacks it.
const FONTS={default:['Default','Inter,"Helvetica Neue",Arial,sans-serif'],system:['System','-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'],rounded:['Rounded','ui-rounded,"SF Pro Rounded",Nunito,"Varela Round",system-ui,sans-serif'],serif:['Serif','ui-serif,"New York",Charter,Georgia,"Times New Roman",serif'],mono:['Mono','ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace']};

function validZone(z){ try{ new Intl.DateTimeFormat('en-US',{timeZone:z}); return true; }catch{ return false; } }
function clean(v){
  const o={...DEFAULTS}; if(!v||typeof v!=='object') return o;
  if(['system','dark','light'].includes(v.theme)) o.theme=v.theme;
  if(Object.hasOwn(ACCENTS,v.accent||'')) o.accent=v.accent;
  if(Object.hasOwn(FONTS,v.font||'')) o.font=v.font;
  if(typeof v.timeZone==='string'&&(v.timeZone===''||validZone(v.timeZone))) o.timeZone=v.timeZone;
  const d=Number(v.dayEnds); if(Number.isInteger(d)&&d>=0&&d<=6) o.dayEnds=d;
  if(['lbs','kg'].includes(v.weight)) o.weight=v.weight;
  if(['imperial','metric'].includes(v.length)) o.length=v.length;
  // The automatic Sunday review: on or off, and the hour (noon to 11 PM) it's written and you're notified.
  if(v.reviewAuto===false||v.reviewAuto==='false') o.reviewAuto=false; else if(v.reviewAuto===true||v.reviewAuto==='true') o.reviewAuto=true;
  const rh=Number(v.reviewHour); if(Number.isInteger(rh)&&rh>=12&&rh<=23) o.reviewHour=rh;
  return o;
}
function read(){ try{ return clean(JSON.parse(localStorage.getItem(KEY)||'null')); }catch{ return clean(null); } }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(s)); }catch{} }
let s=read();

const media=window.matchMedia?window.matchMedia('(prefers-color-scheme: light)'):null;
const mode=()=>s.theme==='system'?(media&&media.matches?'light':'dark'):s.theme;
const accentColor=(name,m)=>ACCENTS[name][m==='light'?2:1];
function apply(){
  const root=document.documentElement, m=mode();
  root.dataset.theme=m;
  if(!OWN_ACCENT){ root.style.setProperty('--mint',accentColor(s.accent,m)); root.style.setProperty('--accent',accentColor(s.accent,m)); }
  root.style.setProperty('--sans',FONTS[s.font][1]);
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.content=(OWN_ACCENT&&getComputedStyle(root).getPropertyValue('--bg').trim())||(m==='light'?'#f6f5f1':'#0a0a0b');
}

const listeners=[];
function notify(keys,remote){ for(const f of listeners){ try{ f(s,keys,remote); }catch(e){ console.error(e); } } }
// A change made here on the page.
function set(patch){ s=clean({...s,...patch}); save(); apply(); notify(Object.keys(patch),false); }
// Settings that arrived from your account: applied without being sent back.
function replace(v){ const next=clean(v); if(JSON.stringify(next)===JSON.stringify(s)) return; s=next; save(); apply(); notify(Object.keys(DEFAULTS),true); }
if(media) (media.addEventListener?media.addEventListener('change',()=>{ if(s.theme==='system'){ apply(); notify(['theme'],true); } }):null);

// ---- days: in your time zone, with your day running until dayEnds o'clock ----
const zone=()=>s.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
const formats={};
function partsOf(t){
  const z=s.timeZone||'';
  const f=formats[z]||(formats[z]=new Intl.DateTimeFormat('en-US',{timeZone:z||undefined,year:'numeric',month:'2-digit',day:'2-digit'}));
  const p={}; for(const x of f.formatToParts(new Date(t))) p[x.type]=x.value; return p;
}
// The day a moment belongs to, as YYYY-MM-DD. With "day ends at 3 AM", 1:30 AM still counts as the day before.
function dayOf(ts){ const p=partsOf(new Date(ts).getTime()-s.dayEnds*3600000); return `${p.year}-${p.month}-${p.day}`; }
// A clock time in your time zone.
function clock(ts){ return new Date(ts).toLocaleTimeString([], {timeZone:s.timeZone||undefined,hour:'numeric',minute:'2-digit'}); }

// ---- units ----
const LB=0.45359237;
// A weight in the unit you chose. Rows without a unit are taken as pounds, BODY's default.
function weight(value,unit){
  const from=String(unit||'lbs').toLowerCase().startsWith('k')?'kg':'lbs'; let n=Number(value);
  if(from!==s.weight) n=s.weight==='kg'?n*LB:n/LB;
  return {value:n,unit:s.weight};
}

// Reads your settings from your account (signed in, with this app's Supabase client) and applies them.
async function sync(db){
  try{ const {data,error}=await db.from('user_settings').select('settings').maybeSingle(); if(error) return false; if(data&&data.settings) replace({...s,...data.settings}); return true; }
  catch{ return false; }
}

window.youSettings={get:()=>s,set,replace,sync,on:f=>listeners.push(f),mode,dayOf,clock,weight,zone,accentColor,DEFAULTS,ACCENTS,FONTS};
apply();
})();
