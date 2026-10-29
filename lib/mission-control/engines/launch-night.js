/**
 * Mission Control · Launch Night (concept C, decision 68) — the broadcast mode.
 *
 * Ported from `docs/research/ryntra-launch-2026-10-25/concepts/launch-night.html`: the same two pads, floodlights,
 * crowd of phone lights, orbit line, camera cuts, synth and quality tiers. LIVE it is a broadcast of the real sky —
 * the two highest missions in `ascent` on the pads, the Flight Director lower third speaking only templated lines
 * built from real events and numbers. `playDemo()` runs the concept's deterministic $EMBER vs $TIDE duel, marked
 * DEMO throughout; the two are never mixed. Styles: `launch-night.css` (root class `.mc-launch-night`).
 */
import * as THREE from "three-r147";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/* ---------------- utils ---------------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const EZ={io:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,out:t=>1-Math.pow(1-t,3),sm:t=>t*t*(3-2*t)};
const fmtInt=n=>Math.round(n).toLocaleString('en-US');
const fmtUsd=(n,d)=>'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:d||0,maximumFractionDigits:d||0});
const fmtUsdAuto=n=>fmtUsd(n,Math.abs(n)<10?2:0);
const p2=n=>String(n).padStart(2,'0');
function fmtClock(t){const neg=t<0;const s=neg?Math.ceil(-t-1e-6):Math.floor(t);return(neg?'T-':'T+')+p2(Math.floor(s/3600))+':'+p2(Math.floor(s%3600/60))+':'+p2(s%60);}
function fmtK(v){return '$'+(v/1000).toFixed(1)+'k';}
const isNum=v=>typeof v==='number'&&isFinite(v);
const ESC={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,ch=>ESC[ch]);
const okColor=(v,d)=>typeof v==='string'&&/^#[0-9a-f]{3,8}$/i.test(v)?v:d;
const safeHref=h=>typeof h==='string'&&(/^\/(?!\/)/.test(h)||/^https:\/\//i.test(h))?h:null;
const bareTicker=t=>String(t||'').replace(/^\$/,'');
const WORD=['zero','one','two','three'];

/* ---------------- world + crews ---------------- */
const GOAL=15454;            // DEMO: USDC raised at graduation (Classic curve)
const PAYOUT=123.64;         // DEMO: crew's 40% of the 2% graduation fee
const Y_ORBIT=36, ORBIT_LINE_R=95, ORBIT_LINE_Z=-1.2, PAD_X=8, PAD_TOP=1.45;
/** The two pads: left and right, each with its broadcast colour. */
const SIDE=[
  {side:-1,color:'#4FB8FF',css:'var(--ember)',av:['#4FB8FF','#9FD4FF','#D6E6FF','#5CBDFF']},
  {side: 1,color:'#F5B544',css:'var(--tide)',av:['#F5B544','#FFC7A1','#E8DCC8','#FFD58A']}
];
/** DEMO crews exactly as the concept draws them. */
const DEMO_CREW=[
  {key:'EMBER',crewN:4,len:8.6,rad:.62,fins:4,seed:11,accent:'#4FB8FF',base:'#D3DAE2',nose:.5,extras:false},
  {key:'TIDE', crewN:3,len:7.6,rad:.70,fins:3,seed:23,accent:'#F5B544',base:'#D3DAE2',nose:.5,extras:false}
];
const LIVE_TYPES=new Set(['ignite','buy','sell','booster','orbit','check','lost','star']);
const CHECK_IDX={7:0,30:1,90:2};

/* ---------------- deterministic duel simulator (DEMO) ---------------- */
const SIM_SEED=0x5EA50;
function buildDuel(){
  const rng=mulberry32(SIM_SEED),base=[0,0];
  const plans=[
    {end:28.0,win:{amount:Math.round(.092*GOAL),holders:204},
     kf:[[0,.092],[3,.165],[6,.26],[9,.372],[12,.47],[15,.53],[18,.61],[21,.70],[23,.745],[25,.82],[27,.905],[28,.9455]],
     sc:[{t:23.15,amount:840,tag:'burn'}]},
    {end:34.0,win:{amount:Math.round(.098*GOAL),holders:181},
     kf:[[0,.098],[3,.19],[6,.285],[9,.36],[12,.425],[13,.44],[17,.485],[20,.56],[23,.63],[26,.70],[29,.77],[31,.82],[34,.89]],
     sc:[{t:13.35,amount:560,tag:'answer'},{t:14.9,amount:600,tag:'answer'},{t:16.65,amount:540,tag:'answer'}]}
  ];
  const ev=[];
  plans.forEach((p,s)=>{
    const nC=s===0?31:26;base[s]=p.win.holders-nC;
    for(let i=0;i<nC;i++)ev.push({t:-15.8+rng()*15.3,s,type:'commit'});
    const kfA=(t)=>{const k=p.kf;if(t<=k[0][0])return k[0][1];for(let i=1;i<k.length;i++){if(t<=k[i][0]){const a=k[i-1],b=k[i];return a[1]+(b[1]-a[1])*EZ.sm((t-a[0])/(b[0]-a[0]));}}return k[k.length-1][1];};
    ev.push({t:0,s,type:'window',amount:p.win.amount,holders:p.win.holders});
    let raised=p.win.amount,scSum=0;const sc=p.sc.slice();
    let t=.35+rng()*.3;
    while(t<p.end-.55){
      while(sc.length&&sc[0].t<=t){const e=sc.shift();ev.push({t:e.t,s,type:'buy',amount:e.amount,tag:e.tag,nh:true});raised+=e.amount;scSum+=e.amount;}
      const gap=kfA(t)*GOAL+scSum-raised;
      if(t>1.2&&rng()<.075){const a=Math.round(20+rng()*130);ev.push({t,s,type:'sell',amount:a,exit:rng()<.6});raised-=a;}
      else if(gap>30){const a=Math.round(clamp(Math.min(gap*(.75+rng()*.6),120+rng()*290),8,410));ev.push({t,s,type:'buy',amount:a,nh:rng()<.8});raised+=a;}
      t+=.22+rng()*.44;
    }
    while(sc.length){const e=sc.shift();ev.push({t:e.t,s,type:'buy',amount:e.amount,tag:e.tag,nh:true});raised+=e.amount;}
    let rest=GOAL-raised,tf=p.end-.3;
    while(rest>880){const a=560+Math.round(rng()*220);ev.push({t:tf,s,type:'buy',amount:a,nh:true});raised+=a;rest-=a;tf+=.08;}
    ev.push({t:p.end,s,type:'buy',amount:Math.max(5,rest),nh:true,fin:true});
    ev.push({t:p.end+.001,s,type:'orbit'});
  });
  ev.sort((a,b)=>a.t-b.t);
  return {events:ev,base};
}
const SEASON_LINES=[
  ['$HALO','Day 7 check passed'],['$KITE','buy $240 · altitude 63%'],['$ORCA','Day 30 check passed'],['$FERN','buy $95 · altitude 41%'],
  ['$ZINC','Signal lost · liquidity under floor'],['$PIXEL','Launch Window opens · 00:14:32'],['$MOTH','buy $410 · altitude 77%'],['$NOVA','Day 90 check passed · now a star']
];

/* ---------------- HUD template ---------------- */
const SVG_SOUND='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path data-k="soundWave" d="M17 9l4 6M21 9l-4 6"/></svg>';
const SVG_REPLAY='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const SVG_PLAY='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const TEST_TITLE="Ryntra's own launch — technical validation, not demand";
function sideTpl(L){return `
<div class="side side-${L==='R'?'r':'l'}" data-k="side${L}">
  <div class="crewline"><span class="avs" aria-hidden="true" data-k="avs${L}"></span><span data-k="crew${L}">CREW</span><span class="names" data-k="names${L}"></span><span class="ln-test" data-k="test${L}" title="${TEST_TITLE}" hidden>RYNTRA TEST</span></div>
  <div class="ticker" data-k="tick${L}">—</div>
  <div class="alt"><span class="lbl">ALTITUDE</span><span class="num" data-k="alt${L}">—</span><span class="mc" data-k="mc${L}"></span></div>
  <div class="cp ln-demo-only"><span>CREW POWER</span><span class="cpbar"><i data-k="cpBar${L}"></i></span><b data-k="cp${L}">0</b></div>
  <div class="cp ln-row ln-live-only" data-k="row${L}"></div>
  <div class="meta" data-k="meta${L}">—</div>
  <button class="btn ghost call ln-demo-only" data-k="call${L}" type="button" aria-pressed="false">Call</button>
  <div class="call ln-acts ln-live-only" data-k="acts${L}"></div>
  <div class="altbar" aria-hidden="true"><i data-k="altBar${L}"></i></div>
</div>`;}
const TEMPLATE=`
<div class="ln-stage" data-k="stage" aria-hidden="true"></div>
<div class="vignette" aria-hidden="true"></div>
<div class="fallback">
  <div class="fb">
    <h2>3D needs WebGL — here is the live board</h2>
    <div class="fb-race">
      <div class="fb-orbit" data-k="fbOrbit" data-label="ORBIT · DAMM v2"></div>
      <div class="fb-track" data-k="fbTrackL" style="--crew:var(--ember)"><i data-k="fbFillL"></i><u data-k="fbRocketL"></u><b data-k="fbLblL">—</b></div>
      <div class="fb-track" data-k="fbTrackR" style="--crew:var(--tide)"><i data-k="fbFillR"></i><u data-k="fbRocketR"></u><b data-k="fbLblR">—</b></div>
    </div>
  </div>
</div>
<div class="labels" data-k="labels"></div>
<header class="bar bar-top">
  <a class="ln-back" href="/">← Back to sky</a>
  <div class="brand"><img class="wordmark" src="/brand/ryntra-wordmark-dark.svg" alt="Ryntra" width="87" height="22"><span class="tag">LAUNCH</span></div>
  <span class="pill live"><i></i><span data-k="livePill">LIVE · SOLANA</span></span>
  <span class="season ln-demo-only">SEASON 0 · LAUNCH NIGHT · DUEL 3 OF 6</span>
  <div class="stats ln-demo-only">
    <span class="opt">WATCHING<b data-k="stWatch">3,912</b></span>
    <span>IN ORBIT<b data-k="stOrbit">23</b></span>
    <span>CREATOR FEES<b data-k="stPaid">$4,812</b></span>
  </div>
  <button class="sound" data-k="soundBtn" type="button" aria-pressed="false">${SVG_SOUND}<span><span class="sw">SOUND </span><span data-k="soundTxt">OFF</span></span></button>
</header>
<section class="vs" data-k="vs" aria-label="Live scoreboard">
  <div class="vshead" data-k="vshead">LIVE FROM THE CHAIN</div>
  ${sideTpl('L')}
  <div class="mid">
    <div class="phase" data-k="phase">READING THE CHAIN…</div>
    <div class="vsmark ln-demo-only">VS</div>
    <div class="clock mono" data-k="clock" role="timer" aria-live="off">—</div>
    <div class="split ln-demo-only" aria-hidden="true"><i data-k="splitL" style="width:50%"></i><u></u></div>
    <div class="calls" data-k="callsRow"></div>
  </div>
  ${sideTpl('R')}
</section>
<aside class="cta ln-demo-only" data-k="cta" aria-label="Ryntra Launch">
  <p class="eyebrow">MISSION VS MISSION</p>
  <h1>LAUNCH IS JUST THE BEGINNING.</h1>
  <p>Two missions on two pads, racing to orbit live — a demo of the broadcast.</p>
</aside>
<aside class="cta ln-empty ln-live-only" data-k="empty" aria-label="No missions in flight">
  <p class="eyebrow">LIVE FROM THE CHAIN</p>
  <h1>THE PADS ARE CLEAR.</h1>
  <p>No missions in flight right now. When a mission lifts off, it takes a pad here.</p>
  <div class="row"><button class="btn primary" data-k="demoBtn2" type="button">${SVG_PLAY}Watch the demo</button></div>
</aside>
<aside class="feed" aria-label="Flight log">
  <div class="feed-h"><span data-k="feedTitle">FLIGHT LOG</span><span data-k="feedTag">LIVE</span></div>
  <ol data-k="feedList"></ol>
</aside>
<div class="lower3">
  <div class="l3tag"><i></i><span data-k="l3tag">FLIGHT DIRECTOR</span></div>
  <div class="l3body"><div class="l3text" data-k="l3text" aria-hidden="true"></div><div class="l3tick" data-k="l3tick"></div></div>
  <p class="sr" data-k="l3live" aria-live="polite"></p>
</div>
<div class="cd" data-k="cd" aria-hidden="true"></div>
<div class="otitle" data-k="otitle" aria-hidden="true"></div>
<div class="payout" data-k="payout" aria-hidden="true"></div>
<div class="winner ln-demo-only" data-k="winner" role="status">
  <p class="eyebrow">DUEL RESULT · DEMO</p>
  <h2 class="w-title">Duel to <em>EMBER</em></h2>
  <ul class="w-rows">
    <li><b style="color:var(--ember)">$EMBER</b><span data-k="wTimeL">orbit 00:28</span><span class="g">+$123.64 to the creator</span></li>
    <li data-k="wRowR" class="pending"><b style="color:var(--tide)">$TIDE</b><span data-k="wTimeR">still climbing</span><span class="g" data-k="wPayR"></span></li>
  </ul>
  <div class="w-actions"><button class="btn ghost sm" data-k="shareBtn" type="button">Share the clip</button><button class="btn ghost sm" data-k="replay2" type="button">Replay the duel</button></div>
</div>
<footer class="bar bar-bot">
  <div class="next ln-demo-only">UP NEXT <b>$HALO</b> vs <b>$KITE</b> · DUEL 4 OF 6</div>
  <div class="next ln-live-only">ALTITUDE · THE CURVE'S WAY TO THE DEX</div>
  <span class="pill demo ln-demo-only">DEMO · simulated flights · no real tokens</span>
  <div class="ln-btns">
    <button class="btn ghost sm ln-live-only" data-k="demoBtn" type="button">${SVG_PLAY}Watch the demo</button>
    <button class="btn ghost sm ln-demo-only" data-k="liveBtn" type="button">Back to live</button>
    <button class="btn ghost sm ln-demo-only" data-k="replayBtn" type="button">${SVG_REPLAY}Replay<span class="lg">&nbsp;the duel</span></button>
  </div>
</footer>
<div class="flash" data-k="flash" aria-hidden="true"></div>
<div class="wipe" data-k="wipe" aria-hidden="true"><span>REPLAY · DUEL 3 OF 6</span></div>
<div class="toasts" data-k="toasts" aria-live="polite"></div>`;

const NOOP_FX=()=>({buy(){},sell(){},window(){},ignite(){},arms(){},orbit(){},orbitSky(){},booster(){},check(){},lost(){},
  cut(){},liveCam(){},holdCam(){},reset(){},countdown(){},userCall(){},calls(){},post(){},setRocket(){},label(){},select(){},mode(){},alive(){}});

/** @type {import("../types").MountScene} */
export function mount(root, options){
const opts=options||{};
const RM=!!opts.reducedMotion;
const MIN_FPS=isNum(opts.minFps)&&opts.minFps>0?opts.minFps:30;
const MAX_PR=isNum(opts.maxPixelRatio)&&opts.maxPixelRatio>0?opts.maxPixelRatio:1.75;
function cb(name,...args){const f=opts[name];if(typeof f!=='function')return;try{f(...args);}catch(_e){/* a page callback never stops the scene */}}
const mm=(q)=>{try{return window.matchMedia?window.matchMedia(q).matches:false;}catch(_e){return false;}};
const COARSE=mm('(pointer: coarse)');
const vw=()=>root.clientWidth||window.innerWidth||1;
const vh=()=>root.clientHeight||window.innerHeight||1;
const isPhone=()=>vw()<=760;

let disposed=false;
const timers=new Set();
function later(fn,ms){const id=setTimeout(()=>{timers.delete(id);if(!disposed)fn();},ms);timers.add(id);return id;}
function cancel(id){if(id){clearTimeout(id);timers.delete(id);}}
const listeners=[];
function on(t,type,fn,o){t.addEventListener(type,fn,o);listeners.push([t,type,fn,o]);}

root.classList.add('mc-launch-night','is-boot','is-reading');
if(RM)root.classList.add('is-reduced');
const app=document.createElement('div');app.className='ln-app';app.innerHTML=TEMPLATE;root.appendChild(app);
const $=(k)=>app.querySelector('[data-k="'+k+'"]');

const FX=NOOP_FX();
let mode='live';
let clock=0;

/* ---------------- live state: only what setSnapshot / emit carry ---------------- */
let hasSnap=false,liveSnap=null,network=null,extraStars=0,liveState='',repickAcc=0;
const roster=new Map();          // id -> a mutable copy of the SceneMission
const pads=[null,null];          // mission id on the left / right pad
const padHold=[0,0];             // clock until which a pad keeps its mission (orbit / lost / star moment)
let selectedSide=null;
const liveLog=[];                // the flight log's last lines, newest first, kept across DEMO

/* ---------------- DEMO state (the concept's) ---------------- */
let DUEL=null;
const S={side:[],calls:1284,callsE:668,inOrbit:23,paid:4812,watching:3912,userCall:null,leader:-1,leadT:-99,firstLead:[false,false],
  burst:[[],[]],burstSaid:[false,false],heatSaid:false,half:[false,false],ninety:[false,false],biggest:0};
function freshSide(){return{raised:0,alt:0,holders:0,ever:0,ret:1,cp:0,mc:5000,orbit:false,orbitT:null,buys:0,disp:0,present:true};}
function blankSide(){const sd=freshSide();sd.present=false;return sd;}
S.side=[blankSide(),blankSide()];
function resetState(){
  S.side=[freshSide(),freshSide()];
  for(let s=0;s<2;s++){S.side[s].holders=S.side[s].ever=DUEL.base[s];recompute(S.side[s]);}
  S.calls=1284;S.callsE=668;S.inOrbit=23;S.paid=4812;S.watching=3912;S.userCall=null;S.leader=-1;S.leadT=-99;
  S.firstLead=[false,false];S.burst=[[],[]];S.burstSaid=[false,false];S.heatSaid=false;S.half=[false,false];S.ninety=[false,false];S.biggest=0;
}
function recompute(sd){sd.alt=clamp(sd.raised/GOAL,0,1);sd.ret=sd.ever?sd.holders/sd.ever:1;sd.cp=clamp(Math.round(sd.holders*sd.ret/3.1),0,100);sd.mc=5000*Math.pow(1+2.873*sd.alt,2);}
function applyEvent(e){
  const sd=S.side[e.s];
  if(e.type==='commit'){sd.holders++;sd.ever++;}
  else if(e.type==='window'){sd.raised=e.amount;sd.holders=e.holders;sd.ever=e.holders;}
  else if(e.type==='buy'){sd.raised+=e.amount;sd.buys++;if(e.nh){sd.holders++;sd.ever++;}}
  else if(e.type==='sell'){sd.raised-=e.amount;if(e.exit)sd.holders--;}
  else if(e.type==='orbit'){sd.orbit=true;sd.orbitT=e.t;sd.raised=GOAL;}
  recompute(sd);
}
function presentSides(){const r=[];for(let s=0;s<2;s++)if(S.side[s].present)r.push(s);return r;}

/* ---------------- toasts (DEMO buttons only) ---------------- */
const toastsEl=$('toasts');
function toast(msg){
  const el=document.createElement('div');el.className='toast';el.textContent=msg;toastsEl.appendChild(el);
  while(toastsEl.children.length>2)toastsEl.removeChild(toastsEl.firstChild);
  later(()=>{el.classList.add('out');later(()=>el.remove(),300);},2900);
}

/* ---------------- event feed (log + phone ticker) ---------------- */
const feedList=$('feedList'),l3tick=$('l3tick');
function demoColor(tk){return tk==='$EMBER'?'var(--ember)':tk==='$TIDE'?'var(--tide)':'var(--text)';}
const Feed={pending:[],last:0,
  push(tk,txt,cls,color){this.pending.push({tk,txt,cls,color:color||(mode==='demo'?demoColor(tk):'var(--text)')});if(this.pending.length>5)this.pending.shift();},
  clear(){this.pending.length=0;feedList.innerHTML='';l3tick.textContent='';},
  put(it){
    const li=document.createElement('li');if(it.cls)li.className=it.cls;
    const b=document.createElement('b');b.textContent=it.tk;b.style.color=it.color||'var(--text)';
    const sp=document.createElement('span');sp.innerHTML=it.txt;li.appendChild(b);li.appendChild(sp);
    feedList.insertBefore(li,feedList.firstChild);while(feedList.children.length>7)feedList.removeChild(feedList.lastChild);
    l3tick.innerHTML='';const b2=b.cloneNode(true);l3tick.appendChild(b2);l3tick.appendChild(document.createTextNode('  '));const s2=document.createElement('span');s2.innerHTML=it.txt;l3tick.appendChild(s2);
  },
  update(now){if(!this.pending.length||now-this.last<.34)return;this.last=now;this.put(this.pending.shift());},
  render(list){this.clear();for(let i=list.length-1;i>=0;i--)this.put(list[i]);}
};

/* ---------------- Flight Director (lower third) ---------------- */
const l3text=$('l3text'),l3live=$('l3live');
const Director={q:[],cur:null,shownAt:-99,chars:0,
  say(text,pri,ttl){if(!text)return;this.q.push({text,pri:pri||1,at:performance.now()/1000,ttl:ttl||4});if(pri>=3){this.q=this.q.filter(x=>x.pri>=3);}},
  clear(){this.q.length=0;this.cur=null;l3text.textContent='';l3live.textContent='';},
  update(now,dt){
    const hold=this.cur?(now-this.shownAt):99;
    this.q=this.q.filter(x=>now-x.at<x.ttl||x.pri>=3);
    if(this.q.length){
      let best=0;for(let i=1;i<this.q.length;i++)if(this.q[i].pri>this.q[best].pri)best=i;
      const nx=this.q[best];
      if(!this.cur||hold>2.5||(nx.pri>=3&&nx.pri>this.cur.pri&&hold>.6)||(nx.pri>=this.cur.pri+.3&&hold>1.2)){
        this.q.splice(best,1);const txt=typeof nx.text==='function'?nx.text():nx.text;
        this.cur={text:txt,pri:nx.pri};this.shownAt=now;this.chars=RM?txt.length:0;l3live.textContent=txt;
      }
    }
    if(this.cur){
      const n=this.cur.text.length;
      if(this.chars<n){this.chars=Math.min(n,this.chars+dt*72);const k=Math.floor(this.chars);l3text.innerHTML='';l3text.appendChild(document.createTextNode(this.cur.text.slice(0,k)));if(k<n){const c=document.createElement('span');c.className='car';l3text.appendChild(c);}}
      else if(l3text.textContent!==this.cur.text){l3text.textContent=this.cur.text;}
    }
  }
};
const say=(t,p,ttl)=>Director.say(t,p,ttl);

/* ---------------- sound (WebAudio synth, off until a person turns it on) ---------------- */
const Sound={on:false,ctx:null,master:null,noise:null,rum:null,lastTick:0,delay:null,
  init(){
    if(this.ctx)return true;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;
    try{this.ctx=new AC();}catch(_e){return false;}
    const c=this.ctx;this.master=c.createGain();this.master.gain.value=0;
    const comp=c.createDynamicsCompressor();comp.threshold.value=-16;comp.ratio.value=4;this.master.connect(comp);comp.connect(c.destination);
    const len=c.sampleRate*2,buf=c.createBuffer(1,len,c.sampleRate),d=buf.getChannelData(0);let last=0;
    for(let i=0;i<len;i++){const w=Math.random()*2-1;last=(last+.02*w)/1.02;d[i]=last*3.5;}this.noise=buf;
    this.delay=c.createDelay(1);this.delay.delayTime.value=.23;const fb=c.createGain();fb.gain.value=.32;this.delay.connect(fb);fb.connect(this.delay);
    const wet=c.createGain();wet.gain.value=.33;this.delay.connect(wet);wet.connect(this.master);return true;
  },
  set(v){
    this.on=v;
    if(v){if(!this.init())return;if(this.ctx.state==='suspended')this.ctx.resume();this.master.gain.setTargetAtTime(.75,this.ctx.currentTime,.05);if(racing())this.rumble(true);}
    else if(this.ctx){this.master.gain.setTargetAtTime(0,this.ctx.currentTime,.05);this.stopRumble();}
  },
  env(g,t,a,peak,dec){g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+a+dec);},
  tick(side,big){
    if(!this.on||!this.ctx)return;const c=this.ctx,t=c.currentTime;if(t-this.lastTick<.07)return;this.lastTick=t;
    const o=c.createOscillator(),f=c.createBiquadFilter(),g=c.createGain();o.type='square';o.frequency.value=side<0?2150:1680;
    f.type='bandpass';f.frequency.value=o.frequency.value;f.Q.value=7;this.env(g,t,.004,big?.2:.08,.04);
    o.connect(f);f.connect(g);g.connect(this.master);o.start(t);o.stop(t+.07);
  },
  beep(hi){
    if(!this.on||!this.ctx)return;const c=this.ctx,t=c.currentTime,o=c.createOscillator(),g=c.createGain();
    o.type='sine';o.frequency.value=hi?1320:880;this.env(g,t,.006,hi?.22:.14,hi?.22:.12);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+.3);
  },
  rumble(late){
    if(!this.on||!this.ctx||this.rum)return;const c=this.ctx,t=c.currentTime;
    const src=c.createBufferSource();src.buffer=this.noise;src.loop=true;const lp=c.createBiquadFilter();lp.type='lowpass';
    lp.frequency.setValueAtTime(late?200:70,t);if(!late){lp.frequency.exponentialRampToValueAtTime(420,t+2.2);lp.frequency.exponentialRampToValueAtTime(190,t+6);}
    const g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(late?.4:1.0,t+(late?.4:.6));if(!late)g.gain.exponentialRampToValueAtTime(.42,t+6);
    const sub=c.createOscillator();sub.type='sine';sub.frequency.value=38;const sg=c.createGain();sg.gain.setValueAtTime(.0001,t);sg.gain.exponentialRampToValueAtTime(late?.12:.35,t+.5);if(!late)sg.gain.exponentialRampToValueAtTime(.12,t+6);
    src.connect(lp);lp.connect(g);g.connect(this.master);sub.connect(sg);sg.connect(this.master);src.start(t);sub.start(t);this.rum={src,sub,g,sg};
  },
  level(v){if(this.rum&&this.ctx)this.rum.g.gain.setTargetAtTime(Math.max(.0001,v),this.ctx.currentTime,.5);},
  stopRumble(){if(!this.rum||!this.ctx)return;const r=this.rum,t=this.ctx.currentTime;r.g.gain.setTargetAtTime(.0001,t,.7);r.sg.gain.setTargetAtTime(.0001,t,.7);r.src.stop(t+3.5);r.sub.stop(t+3.5);this.rum=null;},
  chime(big){
    if(!this.on||!this.ctx)return;const c=this.ctx,t0=c.currentTime;
    const notes=big?[523.25,659.25,783.99,1046.5,1318.51]:[587.33,739.99,880,1174.66];
    notes.forEach((f,i)=>{const t=t0+i*.095,o=c.createOscillator(),o2=c.createOscillator(),g=c.createGain();o.type='sine';o2.type='triangle';o.frequency.value=f;o2.frequency.value=f*2;
      const g2=c.createGain();g2.gain.value=.18;this.env(g,t,.008,big?.2:.13,1.5);o.connect(g);o2.connect(g2);g2.connect(g);g.connect(this.master);g.connect(this.delay);o.start(t);o2.start(t);o.stop(t+1.7);o2.stop(t+1.7);});
    const src=c.createBufferSource();src.buffer=this.noise;const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=900;bp.Q.value=.6;
    const g=c.createGain();g.gain.setValueAtTime(.0001,t0);g.gain.exponentialRampToValueAtTime(big?.35:.2,t0+.45);g.gain.exponentialRampToValueAtTime(.0001,t0+2.8);
    src.connect(bp);bp.connect(g);g.connect(this.master);src.start(t0);src.stop(t0+3);
  },
  close(){this.rum=null;if(this.ctx){try{this.ctx.close();}catch(_e){/* already closed */}}this.ctx=null;this.on=false;}
};
const soundBtn=$('soundBtn'),soundTxt=$('soundTxt'),soundWave=$('soundWave');
let soundPref=false;
function paintSound(v){soundBtn.setAttribute('aria-pressed',v?'true':'false');soundTxt.textContent=v?'ON':'OFF';soundWave.setAttribute('d',v?'M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10':'M17 9l4 6M21 9l-4 6');}
function setSoundInternal(v){soundPref=!!v;paintSound(soundPref);Sound.set(soundPref);}
paintSound(false);
on(soundBtn,'click',()=>setSoundInternal(!soundPref));
on(document,'visibilitychange',()=>{if(!Sound.ctx)return;try{if(document.hidden)Sound.ctx.suspend();else if(Sound.on)Sound.ctx.resume();}catch(_e){/* ignore */}});

/* ---------------- DEMO timeline: idle -> count -> race -> post ---------------- */
const T_START=-16;
const TL={t:T_START,phase:'idle',idx:0,beats:[],lastBeep:99};
function allOrbit(){if(mode==='demo')return S.side[0].orbit&&S.side[1].orbit;const p=presentSides();return p.length>0&&p.every(s=>S.side[s].orbit);}
function racing(){return mode==='demo'?TL.phase==='race'&&!allOrbit():presentSides().some(s=>!S.side[s].orbit);}
const cdEl=$('cd'),cta=$('cta'),winner=$('winner'),otitle=$('otitle'),payoutEl=$('payout'),flashEl=$('flash'),emptyCard=$('empty');
function setPhase(p){TL.phase=p;root.dataset.phase=p;}
function makeBeats(){
  return [
    {t:-16,f:()=>say('Two crews. One sky. First to the orbit line.',1,6)},
    {t:-12.9,f:()=>say('Flight calls are free. Pick a crew before T-0.',1,5)},
    {t:-10,f:()=>{setPhase('count');cta.classList.add('hide');FX.countdown();FX.cut('padL');say('Final count. EMBER, crew of 4. TIDE, crew of 3. Both crews are go.',2,5);}},
    {t:-6.6,f:()=>{FX.cut('padR');say(()=>`Window open: ${S.side[0].holders + S.side[1].holders} holders in. All fill at one fair price at T-0.`,2,5);}},
    {t:-3.3,f:()=>{FX.arms();FX.cut('wideLow');say('Gantry arms clear. Engines arming.',2,4);}},
    {t:0,f:ignite},
    {t:4.6,f:()=>FX.cut('wide')},
    {t:9.4,f:()=>FX.cut('closeL')},
    {t:15.2,f:()=>FX.cut('closeR')},
    {t:20.6,f:()=>FX.cut('wideArc')},
    {t:30.6,f:()=>FX.cut('closeR')},
    {t:35.4,f:()=>FX.cut('final')},
    {t:39.8,f:enterPost},
    {t:47,f:()=>{root.classList.remove('post-a');root.classList.add('post-b');}}
  ].map(b=>Object.assign(b,{done:false}));
}
function ignite(){
  setPhase('race');cdEl.classList.remove('on');FX.ignite([0,1]);Sound.rumble(false);
  say('Liftoff! EMBER and TIDE clear the pads together.',3,5);
  Feed.push('LIFTOFF','Duel 3 of 6 · both crews burning','gold');
}
function enterPost(){
  setPhase('post');cta.classList.remove('hide');root.classList.add('post-a');FX.post();
  say('Both creators earned their fees tonight. Next duel: $HALO vs $KITE.',2,9);
  if(S.userCall!==null)Feed.push('YOU',`call on ${DEMO_CREW[S.userCall].key} · counted for the season board`,'gold');
}

/* ---------------- DEMO: reactions to simulated events ---------------- */
function onEvent(e){
  const sd=S.side[e.s],c=DEMO_CREW[e.s],tk='$'+c.key;
  if(e.type==='commit'){FX.buy(e.s,12,e);if(sd.holders%6===0)Feed.push(tk,`window commit · ${sd.holders} holders`);return;}
  if(e.type==='window'){
    FX.window(e.s,e);Feed.push(tk,`window filled · ${e.holders} holders · altitude ${Math.floor(sd.alt*100)}%`);
    if(e.s===1){const h0=S.side[0].holders,h1=S.side[1].holders;say(`Window fills: ${h0} holders for EMBER, ${h1} for TIDE.`,2.3,5);}
    return;
  }
  if(e.type==='buy'){
    const wasBiggest=e.amount>S.biggest;if(e.amount>S.biggest)S.biggest=e.amount;
    FX.buy(e.s,e.amount,e);Sound.tick(SIDE[e.s].side,e.amount>=400);
    if(e.amount>=100||e.tag||e.fin)Feed.push(tk,`buy ${fmtUsd(e.amount)} · altitude ${Math.floor(sd.alt*100)}%`);
    if(e.tag==='burn')say(`Big burn: ${fmtUsd(e.amount)} for ${c.key}${wasBiggest?' — the biggest buy of the night':''}.`,2.6,4);
    if(e.amount>=500){
      const b=S.burst[e.s];b.push({t:e.t,a:e.amount});while(b.length&&e.t-b[0].t>4.05)b.shift();
      if(b.length>=3&&!S.burstSaid[e.s]){S.burstSaid[e.s]=true;const sum=b.reduce((x,y)=>x+y.a,0);say(`${c.key} answers: three buys in four seconds — ${fmtUsd(sum)}.`,2.6,4);}
    }
    if(!S.half[e.s]&&sd.alt>=.5){S.half[e.s]=true;say(()=>`${c.key} passes halfway — market cap ${fmtK(S.side[e.s].mc)}.`,1,2.4);}
    if(!S.ninety[e.s]&&sd.alt>=.9&&!sd.orbit&&!e.fin){S.ninety[e.s]=true;say(e.s===0?'EMBER at 90%. The orbit line is right there.':'TIDE at 90% — one more push.',2.2,3);}
    return;
  }
  if(e.type==='sell'){FX.sell(e.s,e.amount,e);Feed.push(tk,`<span class="dn">sell ${fmtUsd(e.amount)}</span> · altitude ${Math.floor(sd.alt*100)}%`);return;}
  if(e.type==='orbit')orbit(e.s);
}
function leadCheck(){
  if(TL.phase!=='race'||TL.t<2.4||S.side[0].orbit||S.side[1].orbit)return;
  const a=S.side[0].alt,b=S.side[1].alt,d=a-b;let L=S.leader;
  if(d>.006)L=0;else if(d<-.006)L=1;
  if(L!==S.leader){
    const prev=S.leader;S.leader=L;
    if(L>=0&&TL.t-S.leadT>2.6){
      S.leadT=TL.t;const c=DEMO_CREW[L];
      if(prev===-1)say(()=>`${c.key} takes the early lead — altitude ${Math.floor(S.side[L].alt*100)}%.`,2.2,3);
      else if(!S.firstLead[L]&&L===0)say(()=>`EMBER's crew pulls ahead — ${S.side[0].holders} verified holders.`,2.2,3);
      else say(()=>`${c.key} ${S.firstLead[L]?'retakes':'takes'} the lead at ${Math.floor(S.side[L].alt*100)}%.`,2.2,2.6);
      S.firstLead[L]=true;
    }
  }
  if(!S.heatSaid&&TL.t>17.5&&Math.abs(d)<.007&&a<.88){S.heatSaid=true;say(()=>`Dead heat at ${Math.floor(S.side[0].alt*100)}%. Neither crew blinks.`,2.4,3);}
}
let titleTimer=0,winnerTimer=0;
function flash(){if(RM)return;flashEl.classList.remove('on');void flashEl.offsetWidth;flashEl.classList.add('on');}
function bumpStat(k){const el=$(k);el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');}
function showTitle(sub,big,pay){
  otitle.className='otitle'+(big?'':' small');
  otitle.innerHTML='<span class="sub">'+esc(sub)+'</span>'+'ORBIT'.split('').map((ch,i)=>'<span style="--i:'+i+'">'+ch+'</span>').join('');
  void otitle.offsetWidth;otitle.classList.add('on');
  payoutEl.textContent=pay;payoutEl.className='payout'+(big?'':' small');if(pay){void payoutEl.offsetWidth;payoutEl.classList.add('on');}
  cancel(titleTimer);titleTimer=later(()=>otitle.classList.remove('on'),big?3500:2700);
}
function clearTitles(){cancel(titleTimer);cancel(winnerTimer);cdEl.classList.remove('on');otitle.classList.remove('on');payoutEl.classList.remove('on');winner.classList.remove('on');}
function orbit(s){
  const sd=S.side[s],c=DEMO_CREW[s],first=!S.side[1-s].orbit,pay=`+${fmtUsd(PAYOUT,2)} to the creator`;
  S.inOrbit++;S.paid+=PAYOUT;bumpStat('stOrbit');bumpStat('stPaid');
  FX.orbit(s,first);Sound.chime(first);if(allOrbit())Sound.stopRumble();else Sound.level(.28);
  Feed.push('$'+c.key,`ORBIT · +${fmtUsd(PAYOUT,2)} to the creator`,'gold');
  showTitle(first?`$${c.key} · FIRST TO ORBIT`:`$${c.key} · IN ORBIT TOO`,first,pay);
  if(first){
    flash();say(`ORBIT! ${c.key} crosses first — ${pay}.`,3,6);
    $('wTimeL').textContent='orbit at '+fmtClock(sd.orbitT);
    winnerTimer=later(()=>{if(mode==='demo'&&S.side[s].orbit)winner.classList.add('on');},2700);
  }else{
    say(`${c.key} makes orbit too — ${pay}.`,3,6);
    $('wRowR').classList.remove('pending');$('wTimeR').textContent='orbit at '+fmtClock(sd.orbitT);$('wPayR').textContent=pay;
  }
}

/* ---------------- DEMO viewers: free flight calls + watching ---------------- */
let callRng=mulberry32(77),callNext=.6;
function callsUpdate(dt){
  callNext-=dt;if(callNext>0)return;
  const rate=TL.phase==='race'?2.6:TL.phase==='count'?2.0:.9;callNext=-Math.log(1-callRng()*.999)/rate;
  let pE=.52;if(TL.phase==='race')pE=clamp(.5+(S.side[0].alt-S.side[1].alt)*1.6,.3,.72);
  S.calls++;if(callRng()<pE)S.callsE++;
  S.watching=Math.max(3800,S.watching+(callRng()<(TL.phase==='race'?.75:.55)?Math.ceil(callRng()*4):-Math.ceil(callRng()*3)));
  FX.calls();
}
let seasonNext=1.4,seasonIdx=0;
function seasonFeed(dt){
  if(TL.phase!=='idle'&&TL.phase!=='post')return;
  seasonNext-=dt;if(seasonNext>0)return;seasonNext=2.6;
  const l=SEASON_LINES[seasonIdx++%SEASON_LINES.length];Feed.push(l[0],l[1],/Day 90/.test(l[1])?'gold':'');
}

/* ---------------- HUD ---------------- */
const H={};['mcL','mcR','altL','altR','cpL','cpR','cpBarL','cpBarR','metaL','metaR','altBarL','altBarR','rowL','rowR','clock','phase','callsRow','splitL','sideL','sideR',
  'stOrbit','stPaid','stWatch','fbFillL','fbFillR','fbRocketL','fbRocketR','fbLblL','fbLblR','fbTrackL','fbTrackR','fbOrbit','tickL','tickR','avsL','avsR','crewL','crewR',
  'namesL','namesR','testL','testR','callL','callR','actsL','actsR','vs','vshead','livePill','l3tag','feedTitle','feedTag','demoBtn'].forEach(k=>H[k]=$(k));
const cache={};
function setTxt(el,k,v){if(cache[k]!==v){cache[k]=v;el.textContent=v;}}
function setHTML(el,k,v){if(cache[k]!==v){cache[k]=v;el.innerHTML=v;}}
let hudAcc=0;
function fbTrack(s,label,open){
  const L=s?'R':'L',sd=S.side[s];
  H['fbFill'+L].style.height=(sd.disp*100).toFixed(2)+'%';H['fbRocket'+L].style.bottom='calc('+(sd.disp*100).toFixed(2)+'% - '+(sd.disp*24).toFixed(1)+'px)';
  H['fbTrack'+L].classList.toggle('open',!!open);setTxt(H['fbLbl'+L],'fb'+L,label);
}
function demoHud(){
  for(let s=0;s<2;s++){
    const sd=S.side[s],L=s?'R':'L',pct=Math.floor(sd.disp*100+1e-6);
    setHTML(H['alt'+L],'alt'+L,sd.orbit?'ORBIT':pct+'<small>%</small>');H['alt'+L].classList.toggle('orb',sd.orbit);
    setTxt(H['cp'+L],'cp'+L,String(sd.cp));H['cpBar'+L].style.transform='scaleX('+(sd.cp/100).toFixed(3)+')';
    H['altBar'+L].style.transform='scaleX('+sd.disp.toFixed(4)+')';
    setHTML(H['meta'+L],'meta'+L,TL.t<0?`<b>${sd.holders}</b> in the window · fair start`:`<b>${sd.holders}</b> holders × <b>${Math.round(sd.ret*100)}%</b> retained`);setTxt(H['mc'+L],'mc'+L,'MC '+fmtK(sd.mc));
    fbTrack(s,'$'+DEMO_CREW[s].key+' '+(sd.orbit?'ORBIT':pct+'%'),false);
  }
  const rc=TL.phase==='race'&&!S.side[0].orbit&&!S.side[1].orbit;
  H.sideL.classList.toggle('lead',rc&&S.leader===0);H.sideR.classList.toggle('lead',rc&&S.leader===1);
  const ct=TL.phase==='post'?34:TL.t;setTxt(H.clock,'clock',fmtClock(ct));H.clock.classList.toggle('hot',TL.phase==='count');
  setTxt(H.phase,'phase',TL.phase==='idle'?'LAUNCH WINDOW':TL.phase==='count'?'FINAL COUNT':TL.phase==='post'?'DUEL COMPLETE':S.side[0].orbit?'EMBER IN ORBIT':'ASCENT · LIVE');
  setHTML(H.callsRow,'calls','Free flight calls: <b>'+fmtInt(S.calls)+'</b>');H.splitL.style.width=(S.callsE/S.calls*100).toFixed(1)+'%';
  setTxt(H.stOrbit,'stO',String(S.inOrbit));setTxt(H.stPaid,'stP',fmtUsd(S.paid));setTxt(H.stWatch,'stW',fmtInt(S.watching));
}
function holdersTxt(m){return isNum(m.holders)?fmtInt(m.holders)+(m.holdersAtLeast?'+':''):'—';}
function liveHud(){
  for(let s=0;s<2;s++){
    const sd=S.side[s],L=s?'R':'L',m=pads[s]?roster.get(pads[s]):null,pct=Math.floor(sd.disp*100+1e-6);
    let altH='—';
    if(m){altH=sd.orbit?'ORBIT':isNum(m.altitude)?pct+'<small>%</small>':'—';}
    setHTML(H['alt'+L],'alt'+L,altH);H['alt'+L].classList.toggle('orb',!!m&&sd.orbit);
    H['altBar'+L].style.transform='scaleX('+(m?sd.disp:0).toFixed(4)+')';
    setHTML(H['row'+L],'row'+L,m?`HOLDERS <b>${holdersTxt(m)}</b> <span class="sep">·</span> DAY <b>${isNum(m.day)?fmtInt(m.day):'—'}</b>`:'');
    setTxt(H['mc'+L],'mc'+L,'');
    fbTrack(s,m?m.ticker+' '+(sd.orbit?'ORBIT':isNum(m.altitude)?pct+'%':'—'):(hasSnap?'PAD OPEN':'—'),!m);
  }
  H.sideL.classList.remove('lead');H.sideR.classList.remove('lead');H.clock.classList.remove('hot');
  let flight=0,orb=0,star=0;roster.forEach(m=>{if(m.phase==='ascent')flight++;else if(m.phase==='orbit')orb++;else if(m.phase==='star')star++;});
  setTxt(H.phase,'phase',hasSnap?'LIVE FROM THE CHAIN':'READING THE CHAIN…');
  setHTML(H.clock,'clock',hasSnap?fmtInt(flight)+'<small>IN FLIGHT</small>':'—');
  setHTML(H.callsRow,'calls',hasSnap?`IN ORBIT <b>${fmtInt(orb)}</b> · STARS <b>${fmtInt(star+extraStars)}</b>`:'');
}
function hud(dt){
  for(let s=0;s<2;s++){const sd=S.side[s];sd.disp+=(sd.alt-sd.disp)*Math.min(1,dt*6);}
  hudAcc+=dt;if(hudAcc<1/15)return;hudAcc=0;
  if(mode==='demo')demoHud();else liveHud();
}

/* ---------------- core step (every frame, 3D loop or 2D board) ---------------- */
function demoStep(dt){
  const now=performance.now()/1000;
  TL.t+=dt;
  for(const b of TL.beats){if(!b.done&&TL.t>=b.t){b.done=true;b.f();}}
  while(TL.idx<DUEL.events.length&&DUEL.events[TL.idx].t<=TL.t){const e=DUEL.events[TL.idx++];applyEvent(e);onEvent(e);}
  if(TL.phase==='count'){const sec=Math.ceil(-TL.t-1e-6);if(sec!==TL.lastBeep&&sec>=1&&sec<=10){TL.lastBeep=sec;Sound.beep(sec<=3);if(sec<=5){cdEl.textContent=String(sec);cdEl.classList.remove('on');void cdEl.offsetWidth;cdEl.classList.add('on');}}}
  leadCheck();callsUpdate(dt);seasonFeed(dt);
  if(TL.phase==='race'&&TL.t>3&&!S.side[1].orbit&&!Director.q.length&&Director.cur&&now-Director.shownAt>5.4){
    say(()=>{const a=Math.floor(S.side[0].alt*100),b=Math.floor(S.side[1].alt*100),g=Math.abs(a-b);
      if(S.side[0].orbit)return `TIDE at ${b}% and closing on the orbit line.`;
      return g<=1?`Altitude check: EMBER ${a}%, TIDE ${b}%. Side by side.`:`Altitude check: ${a>b?'EMBER':'TIDE'} leads by ${g} points, ${Math.max(a,b)}% to ${Math.min(a,b)}%.`;},.5,2);}
  Feed.update(now);Director.update(now,dt);hud(dt);
}
function altWord(m){return isNum(m.altitude)?Math.floor(m.altitude)+'%':'—';}
function liveStep(dt){
  const now=performance.now()/1000;
  repickAcc+=dt;if(repickAcc>3){repickAcc=0;repick(true);}
  FX.liveCam();
  if(Sound.on){const r=racing();if(r&&!Sound.rum)Sound.rumble(true);else if(!r&&Sound.rum)Sound.stopRumble();}
  if(hasSnap&&presentSides().length&&!Director.q.length&&Director.cur&&now-Director.shownAt>8){
    say(()=>{const ms=presentSides().map(s=>roster.get(pads[s])).filter(Boolean);
      if(!ms.length)return '';
      if(ms.length===1)return `Altitude check: ${ms[0].ticker} at ${altWord(ms[0])}.`;
      return `Altitude check: ${ms[0].ticker} ${altWord(ms[0])}, ${ms[1].ticker} ${altWord(ms[1])}.`;},.5,2);
  }
  Feed.update(now);Director.update(now,dt);hud(dt);
}
function step(dt){if(mode==='demo')demoStep(dt);else liveStep(dt);}

/* ---------------- DEMO buttons ---------------- */
function userCall(s){
  if(mode!=='demo')return;
  const c=DEMO_CREW[s];
  if(S.userCall===null){S.calls++;if(s===0)S.callsE++;}else if(S.userCall!==s){S.callsE+=s===0?1:-1;}
  S.userCall=s;
  [H.callL,H.callR].forEach((el,i)=>{el.classList.toggle('picked',i===s);el.setAttribute('aria-pressed',i===s?'true':'false');});
  toast('Demo: calls are free and count for the season board');
  Feed.push('YOU',`flight call on ${c.key} · free`,'');FX.userCall(s);
}
function resetDemoHud(){
  $('wRowR').classList.add('pending');$('wTimeR').textContent='still climbing';$('wPayR').textContent='';
  [H.callL,H.callR].forEach(el=>{el.classList.remove('picked');el.setAttribute('aria-pressed','false');});
}
let replayLock=false,wipeT1=0,wipeT2=0;
function doReset(){
  resetState();TL.t=-10.6;TL.idx=0;TL.lastBeep=99;setPhase('idle');
  while(TL.idx<DUEL.events.length&&DUEL.events[TL.idx].t<=TL.t)applyEvent(DUEL.events[TL.idx++]);
  TL.beats=makeBeats();TL.beats.forEach(b=>{if(b.t<TL.t)b.done=true;});
  Director.clear();Feed.clear();Feed.push('REPLAY','Duel 3 of 6 · from T-10','gold');
  clearTitles();
  root.classList.remove('post-a','post-b');cta.classList.add('hide');
  resetDemoHud();
  Sound.stopRumble();FX.reset();
  say('Replay: same crews, same sky. Watch the final count.',2,4);
}
function replay(){
  if(mode!=='demo'||replayLock)return;replayLock=true;
  if(RM){doReset();replayLock=false;return;}
  const w=$('wipe');w.classList.remove('on');void w.offsetWidth;w.classList.add('on');
  wipeT1=later(()=>{if(mode==='demo')doReset();},520);wipeT2=later(()=>{w.classList.remove('on');replayLock=false;},1250);
}
on($('shareBtn'),'click',()=>toast('Demo: the duel clip is shared from the live show.'));
on(H.callL,'click',()=>userCall(0));
on(H.callR,'click',()=>userCall(1));
on($('replayBtn'),'click',replay);
on($('replay2'),'click',replay);
on(H.demoBtn,'click',()=>playDemo());
on($('demoBtn2'),'click',()=>playDemo());
on($('liveBtn'),'click',()=>stopDemo());
function pickSide(s){
  if(mode!=='live')return;const id=pads[s];if(!id)return;
  if(selectedSide===s){applySelect(null);cb('onSelect',null);}else{applySelect(id);cb('onSelect',id);}
}
[H.tickL,H.tickR].forEach((el,s)=>{
  on(el,'click',()=>pickSide(s));
  on(el,'keydown',(e)=>{if((e.key==='Enter'||e.key===' ')&&el.hasAttribute('data-pick')){e.preventDefault();pickSide(s);}});
});

/* ---------------- LIVE: the roster, the two pads, the events ---------------- */
function normMission(m){
  const ck=Array.isArray(m.checks)?m.checks:[];
  return {id:m.id,ticker:typeof m.ticker==='string'&&m.ticker?m.ticker:'$—',name:typeof m.name==='string'?m.name:'',
    phase:m.phase,altitude:isNum(m.altitude)?clamp(m.altitude,0,100):null,day:isNum(m.day)?m.day:null,
    checks:[ck[0]||'unread',ck[1]||'unread',ck[2]||'unread'],
    holders:isNum(m.holders)?m.holders:null,holdersAtLeast:m.holdersAtLeast===true,
    crew:Array.isArray(m.crew)?m.crew.filter(x=>typeof x==='string'):[],
    ryntraTest:m.ryntraTest===true,ship:m.ship&&typeof m.ship==='object'?m.ship:null,href:safeHref(m.href)};
}
/** The mission's own ship from its genome: the same mint draws the same ship. */
function shipSpec(m){
  const g=m.ship||{};
  return {id:m.id,key:m.ticker,len:8.1*clamp(isNum(g.length)?g.length:1,.8,1.25),rad:.66*clamp(isNum(g.radius)?g.radius:1,.8,1.25),fins:g.fins===3?3:4,
    seed:isNum(g.seed)?(Math.abs(Math.floor(g.seed))%2147483647)||1:1,accent:okColor(g.accent,'#4FB8FF'),base:okColor(g.base,'#D3DAE2'),
    nose:clamp(isNum(g.nose)?g.nose:.5,0,1),extras:true};
}
const aliveCount=m=>m.checks.filter(c=>c==='alive').length;
function rankCmp(a,b){const aa=isNum(a.altitude)?a.altitude:-1,bb=isNum(b.altitude)?b.altitude:-1;if(bb!==aa)return bb-aa;return (isNum(b.holders)?b.holders:-1)-(isNum(a.holders)?a.holders:-1);}
function syncSide(s){
  const id=pads[s],m=id?roster.get(id):null,sd=S.side[s];
  if(!m){sd.present=false;sd.alt=0;return;}
  sd.present=true;sd.holders=isNum(m.holders)?m.holders:0;
  if(sd.orbit||m.phase==='orbit'||m.phase==='star'){sd.orbit=true;sd.alt=1;}
  else sd.alt=isNum(m.altitude)?clamp(m.altitude/100,0,1):0;
}
function pinned(s){return pads[s]!==null&&clock<padHold[s]&&roster.has(pads[s]);}
/** The two missions in `ascent` with the highest altitude (ties: more holders) hold the pads; a pad changes hands
 * only when a challenger is more than two points higher, and never during an orbit / lost / star moment. */
function repick(announce){
  if(mode!=='live'||!hasSnap)return;
  const next=pads.slice();
  for(let s=0;s<2;s++){const id=next[s];if(!id||pinned(s))continue;const m=roster.get(id);if(!m||m.phase!=='ascent')next[s]=null;}
  const free=[...roster.values()].filter(m=>m.phase==='ascent'&&!next.includes(m.id)).sort(rankCmp);
  for(let s=0;s<2;s++)if(next[s]===null&&free.length)next[s]=free.shift().id;
  if(free.length){
    const occ=[0,1].filter(s=>next[s]&&!pinned(s)).sort((x,y)=>rankCmp(roster.get(next[y]),roster.get(next[x])));
    for(const s of occ){
      if(!free.length)break;const cur=roster.get(next[s]),ch=free[0];
      const ca=isNum(cur.altitude)?cur.altitude:-1,cha=isNum(ch.altitude)?ch.altitude:-1;
      if(cha>ca+2){next[s]=ch.id;free.shift();}
    }
  }
  if(next[0]===null&&next[1]!==null&&!pinned(1)){next[0]=next[1];next[1]=null;}
  for(let s=0;s<2;s++)if(next[s]!==pads[s])assignSide(s,next[s],announce);
  updateEmpty();
}
function assignSide(s,id,announce){
  pads[s]=id;padHold[s]=0;if(selectedSide===s){selectedSide=null;FX.select(null);}
  S.side[s]=blankSide();
  const m=id?roster.get(id):null;
  if(m){syncSide(s);S.side[s].disp=S.side[s].alt;}
  FX.setRocket(s,m?shipSpec(m):null,m?aliveCount(m):0);
  renderLiveSide(s);
  if(announce&&m)say(`${m.ticker} takes pad ${s?'two':'one'} — altitude ${altWord(m)}.`,1.5,4);
}
const sideSig=['',''];
function renderLiveSide(s){
  const L=s?'R':'L',m=pads[s]?roster.get(pads[s]):null,tick=H['tick'+L];
  const sig=m?JSON.stringify([m.id,m.ticker,m.name,m.crew,m.ryntraTest,m.href]):'open:'+hasSnap;
  if(sig===sideSig[s])return;sideSig[s]=sig;
  H['side'+L].classList.toggle('open',!m);
  if(m){
    H['avs'+L].innerHTML=m.crew.slice(0,4).map((n,k)=>`<i style="background:${SIDE[s].av[k%4]}">${esc((n.replace(/^@/,'').trim()[0]||'·').toUpperCase())}</i>`).join('');
    /* MC-2: a crew the vault pays reads as one — the creator alone stays CREATOR. */
    H['crew'+L].textContent=m.crew.length>1?'CREW OF '+m.crew.length:m.crew.length?'CREATOR':'CREATOR —';
    H['names'+L].textContent=m.crew.join(' · ');
    H['test'+L].hidden=!m.ryntraTest;
    tick.innerHTML='<em>$</em>'+esc(bareTicker(m.ticker));
    tick.setAttribute('data-pick','');tick.setAttribute('role','button');tick.setAttribute('tabindex','0');tick.setAttribute('title','Bring the camera to '+m.ticker);
    H['acts'+L].innerHTML=(m.href?`<a href="${esc(m.href)}"><span class="ln-sm-hide">Open </span>Control Room</a>`:'')+`<a class="trade" href="/app/launch/${encodeURIComponent(m.id)}">Trade</a>`;
    H['meta'+L].textContent=m.name||'—';
  }else{
    H['avs'+L].innerHTML='';H['crew'+L].textContent=hasSnap?'PAD '+(s?'TWO':'ONE'):'READING…';H['names'+L].textContent='';H['test'+L].hidden=true;
    tick.textContent=hasSnap?'PAD OPEN':'—';
    ['data-pick','role','tabindex','title'].forEach(a=>tick.removeAttribute(a));
    H['acts'+L].innerHTML='';H['meta'+L].textContent='—';
  }
  FX.label(s,m?m.ticker:'');
}
function renderDemoSides(){
  const crews=[['Mira K.','Oto','Lea V.','Ravi S.'],['Noa B.','Iko','Tess M.']];
  for(let s=0;s<2;s++){
    const L=s?'R':'L',c=DEMO_CREW[s],tick=H['tick'+L];sideSig[s]='';
    H['side'+L].classList.remove('open');
    H['avs'+L].innerHTML=crews[s].map((n,k)=>`<i style="background:${SIDE[s].av[k]}">${n[0]}</i>`).join('');
    H['crew'+L].textContent=`CREW OF ${c.crewN}`;H['names'+L].textContent=crews[s].join(' · ');H['test'+L].hidden=true;
    tick.innerHTML='<em>$</em>'+c.key;['data-pick','role','tabindex','title'].forEach(a=>tick.removeAttribute(a));
    H['call'+L].textContent='Call '+c.key;H['acts'+L].innerHTML='';H['meta'+L].textContent='—';
    FX.label(s,'$'+c.key);
  }
}
function updateEmpty(){
  if(mode!=='live')return;
  const any=pads[0]!==null||pads[1]!==null,st=!hasSnap?'reading':any?'flight':'empty';
  root.classList.toggle('is-reading',st==='reading');root.classList.toggle('is-empty',st==='empty');
  H.demoBtn.classList.toggle('primary',st==='empty');H.demoBtn.classList.toggle('ghost',st!=='empty');
  if(st===liveState)return;liveState=st;
  if(st==='reading')say('Reading the chain…',2,99);
  else if(st==='empty')say('No missions in flight right now.',2.2,99);
  else{
    const ms=presentSides().map(s=>roster.get(pads[s])).filter(Boolean);
    if(ms.length)say(ms.length>1?`Live from the chain: ${ms[0].ticker} at ${altWord(ms[0])}, ${ms[1].ticker} at ${altWord(ms[1])}.`:`Live from the chain: ${ms[0].ticker} at ${altWord(ms[0])}.`,2,5);
  }
}
function paintModeText(){
  const demo=mode==='demo';
  H.livePill.textContent=demo?'DEMO':network==='devnet'?'LIVE · DEVNET':'LIVE · SOLANA';
  H.l3tag.textContent=demo?'AI FLIGHT DIRECTOR':'FLIGHT DIRECTOR';
  H.feedTitle.textContent=demo?'RACE LOG':'FLIGHT LOG';H.feedTag.textContent=demo?'DEMO':'LIVE';
  H.vshead.textContent=demo?'SEASON 0 · LAUNCH NIGHT · DUEL 3 OF 6':'LIVE FROM THE CHAIN';
  H.vs.setAttribute('aria-label',demo?'Duel scoreboard: EMBER versus TIDE':'Live from the chain: the two highest missions in flight');
  H.fbOrbit.setAttribute('data-label',demo?'ORBIT · 15,454 USDC':'ORBIT · DAMM v2');
  for(const k in cache)delete cache[k];
  FX.mode();
}
function logLine(m,txt,cls,quiet){
  const s=pads.indexOf(m.id),it={tk:m.ticker,txt,cls:cls||'',color:s>=0?SIDE[s].css:'var(--text)'};
  liveLog.unshift(it);if(liveLog.length>7)liveLog.length=7;
  if(quiet)Feed.put(it);else Feed.push(it.tk,it.txt,it.cls,it.color);
}
function liveOrbit(m,s,pay){
  const sub=`${m.ticker} reached orbit · DAMM v2 pool open`+(pay!==null?` · +${fmtUsd(pay,2)} to the creator`:'');
  if(s>=0){const sd=S.side[s];sd.orbit=true;sd.alt=1;sd.orbitT=clock;FX.orbit(s,true);padHold[s]=clock+9;FX.holdCam('wideArc',7);}
  else FX.orbitSky();
  Sound.chime(true);if(!racing())Sound.stopRumble();else Sound.level(.28);
  showTitle(sub,true,'');flash();
  say(`${m.ticker} reaches orbit. The DAMM v2 pool is open.`,3,6);
}
function ingest(snap){
  const first=!hasSnap;hasSnap=true;
  network=snap.network==='devnet'?'devnet':snap.network==='mainnet'?'mainnet':null;
  extraStars=isNum(snap.stars)?Math.max(0,Math.floor(snap.stars)):0;
  const seen=new Set();
  (Array.isArray(snap.missions)?snap.missions:[]).forEach(m=>{if(!m||typeof m.id!=='string')return;seen.add(m.id);roster.set(m.id,normMission(m));});
  for(const id of [...roster.keys()])if(!seen.has(id))roster.delete(id);
  for(let s=0;s<2;s++){const id=pads[s];if(id&&roster.has(id)){syncSide(s);FX.alive(s,aliveCount(roster.get(id)));}renderLiveSide(s);}
  paintModeText();
  repick(!first);
  for(let s=0;s<2;s++)renderLiveSide(s);
  updateEmpty();
}
/** One live event: the numbers first, then — unless it is quiet history — the concept's effect for it. */
function liveEmit(e){
  if(!e||typeof e!=='object'||!LIVE_TYPES.has(e.type)||typeof e.id!=='string')return;
  const m=roster.get(e.id);if(!m)return;
  const quiet=e.quiet===true,t=e.type;
  let s=pads.indexOf(e.id);
  if(t==='buy'||t==='sell'){
    if(isNum(e.altitude))m.altitude=clamp(e.altitude,0,100);
    const usd=isNum(e.usd)&&e.usd>0?e.usd:null,amt=usd===null?'':' '+fmtUsdAuto(usd),altTxt=isNum(m.altitude)?` · altitude ${Math.floor(m.altitude)}%`:'';
    if(s>=0)syncSide(s);
    logLine(m,t==='buy'?`buy${amt}${altTxt}`:`<span class="dn">sell${amt}</span>${altTxt}`,'',quiet);
    if(!quiet&&s>=0){
      if(t==='buy'){FX.buy(s,usd,{type:'buy',live:true});Sound.tick(SIDE[s].side,(usd||0)>=400);
        if(usd!==null&&usd>=250)say(`${m.ticker}: a ${fmtUsdAuto(usd)} buy${isNum(m.altitude)?` — altitude ${Math.floor(m.altitude)}%`:''}.`,1.2,3);}
      else{FX.sell(s,usd);
        if(usd!==null&&usd>=250)say(`${m.ticker}: a ${fmtUsdAuto(usd)} sell${isNum(m.altitude)?` — altitude ${Math.floor(m.altitude)}%`:''}.`,1.2,3);}
    }
  }else if(t==='ignite'){
    if(!quiet){repick(false);s=pads.indexOf(e.id);}
    logLine(m,'ignition · a new mission is in flight','gold',quiet);
    if(!quiet){if(s>=0){FX.ignite([s]);Sound.beep(true);}say(`${m.ticker} lights up — a new mission is in flight.`,2,4);}
  }else if(t==='booster'){
    const n=e.n===1||e.n===2||e.n===3?e.n:0;if(!n)return;
    logLine(m,`booster ${n} · ${n*25}%`,'',quiet);
    if(!quiet){if(s>=0)FX.booster(s,n);say(`${m.ticker} crosses ${n*25}% — booster ${WORD[n]}.`,2,4);}
  }else if(t==='orbit'){
    m.phase='orbit';m.altitude=100;
    const pay=isNum(e.payoutUsd)?e.payoutUsd:null;
    logLine(m,pay!==null?`ORBIT · +${fmtUsd(pay,2)} to the creator`:'ORBIT · DAMM v2 pool open','gold',quiet);
    if(!quiet)liveOrbit(m,s,pay);else if(s>=0)syncSide(s);
  }else if(t==='check'){
    if(!Object.prototype.hasOwnProperty.call(CHECK_IDX,e.day))return;
    m.checks[CHECK_IDX[e.day]]='alive';if(s>=0)FX.alive(s,aliveCount(m));
    logLine(m,`Day ${e.day} check passed`,e.day===90?'gold':'',quiet);
    if(!quiet){say(`${m.ticker} passes the Day ${e.day} check.`,1.6,4);Sound.beep(false);if(s>=0)FX.check(s);}
  }else if(t==='lost'){
    if(!Object.prototype.hasOwnProperty.call(CHECK_IDX,e.day))return;
    m.phase='lost';
    /* MC-3: calm, with its reason — the scene's own words (`signalLost` in scene.ts). */
    const why=typeof e.reason==='string'&&e.reason?e.reason:'';
    logLine(m,`<span class="mut">Signal lost</span> · Day ${e.day} check${why?' · '+esc(why):''}`,'',quiet);
    if(!quiet){say(`${m.ticker}: signal lost at the Day ${e.day} check.`,1.8,4);if(s>=0){FX.lost(s);padHold[s]=clock+4;}}
  }else if(t==='star'){
    m.phase='star';
    logLine(m,'Day 90 · now a star','gold',quiet);
    if(!quiet){say(`${m.ticker} passes Day 90 — now a star.`,2,4);Sound.chime(false);if(s>=0)padHold[s]=clock+4;}
  }
}
function applySelect(id){
  if(mode!=='live')return;
  if(id==null)selectedSide=null;else{const s=pads.indexOf(id);selectedSide=s>=0?s:null;}
  FX.select(selectedSide);
}

/* ---------------- DEMO on / off ---------------- */
function playDemo(){
  if(disposed)return;
  if(!DUEL)DUEL=buildDuel();
  mode='demo';root.classList.add('is-demo');root.classList.remove('is-empty','is-reading');
  selectedSide=null;FX.select(null);
  cancel(wipeT1);cancel(wipeT2);replayLock=false;$('wipe').classList.remove('on');
  Director.clear();Feed.clear();clearTitles();toastsEl.innerHTML='';
  resetState();TL.t=T_START;TL.idx=0;TL.lastBeep=99;TL.beats=makeBeats();setPhase('idle');
  callRng=mulberry32(77);callNext=.6;seasonNext=1.4;seasonIdx=0;
  root.classList.remove('post-a','post-b');cta.classList.remove('hide');resetDemoHud();
  Sound.stopRumble();
  paintModeText();renderDemoSides();
  FX.setRocket(0,DEMO_CREW[0],0);FX.setRocket(1,DEMO_CREW[1],0);FX.reset();
  cb('onSource','demo');
}
function stopDemo(){
  if(disposed||mode!=='demo')return;
  mode='live';root.classList.remove('is-demo','post-a','post-b');
  cancel(wipeT1);cancel(wipeT2);replayLock=false;$('wipe').classList.remove('on');
  clearTitles();cta.classList.add('hide');toastsEl.innerHTML='';
  Director.clear();Feed.clear();Sound.stopRumble();setPhase('live');
  pads[0]=pads[1]=null;padHold[0]=padHold[1]=0;selectedSide=null;sideSig[0]=sideSig[1]='';
  S.side=[blankSide(),blankSide()];
  FX.reset();FX.setRocket(0,null,0);FX.setRocket(1,null,0);FX.select(null);
  liveState='';hasSnap=false;roster.clear();
  paintModeText();
  if(liveSnap)ingest(liveSnap);else{renderLiveSide(0);renderLiveSide(1);updateEmpty();}
  Feed.render(liveLog);
  cb('onSource','live');
}

/* ======================= 3D layer ======================= */
function webglOK(){
  try{const c=document.createElement('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl||!window.WebGLRenderingContext)return false;
    const ext=gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();return true;}catch(_e){return false;}
}
function init3D(onLost){
const T=THREE,V3=T.Vector3;
const texList=[];
const col=(h)=>new T.Color(h).convertSRGBToLinear();
const R=new T.WebGLRenderer({antialias:!(isPhone()||COARSE),powerPreference:'high-performance',alpha:false,stencil:false});
R.setPixelRatio(Math.min(window.devicePixelRatio||1,MAX_PR));R.setSize(vw(),vh());
R.setClearColor(0x000000,1);
const stage=$('stage');stage.appendChild(R.domElement);
on(R.domElement,'webglcontextlost',(e)=>{e.preventDefault();onLost();});
const scene=new T.Scene();
scene.fog=new T.FogExp2(new T.Color(.0118,.0196,.0365),.0056);
const camera=new T.PerspectiveCamera(46,vw()/vh(),.1,4000);
camera.position.set(0,6,60);
const ADD={blending:T.AdditiveBlending,transparent:true,depthWrite:false};
const TONE='\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n';
const NOISE=`float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n2(p);p*=2.03;a*=.5;}return s;}`;

/* ---------- generated textures ---------- */
function canvasTex(w,h,draw,srgb,list){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');draw(g,w,h);const t=new T.CanvasTexture(c);if(srgb)t.encoding=T.sRGBEncoding;t.anisotropy=Math.min(8,R.capabilities.getMaxAnisotropy());(list||texList).push(t);return t;}
const glowTex=canvasTex(128,128,(g)=>{const r=g.createRadialGradient(64,64,0,64,64,64);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.16,'rgba(255,255,255,.6)');r.addColorStop(.42,'rgba(255,255,255,.16)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,128,128);});
const streakTex=canvasTex(256,32,(g)=>{const r=g.createLinearGradient(0,0,256,0);r.addColorStop(0,'rgba(255,255,255,0)');r.addColorStop(.5,'rgba(255,255,255,1)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,256,32);const v=g.createLinearGradient(0,0,0,32);v.addColorStop(0,'rgba(0,0,0,1)');v.addColorStop(.5,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,1)');g.globalCompositeOperation='destination-out';g.fillStyle=v;g.fillRect(0,0,256,32);});
const smokeTex=canvasTex(128,128,(g)=>{const rr=mulberry32(5);for(let i=0;i<38;i++){const x=30+rr()*68,y=30+rr()*68,r=10+rr()*28;const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(255,255,255,.24)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,7);g.fill();}
  g.globalCompositeOperation='destination-in';const m=g.createRadialGradient(64,64,8,64,64,63);m.addColorStop(0,'rgba(0,0,0,1)');m.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=m;g.fillRect(0,0,128,128);});
const groundTex=canvasTex(1024,1024,(g,w,h)=>{
  const rr=mulberry32(9),PX=1024/140,P=(x)=>512+x*PX;
  g.fillStyle='#0B1017';g.fillRect(0,0,w,h);
  for(let i=0;i<2600;i++){const x=rr()*w,y=rr()*h,s=2+rr()*16;g.fillStyle=`rgba(${80+rr()*60|0},${92+rr()*60|0},${108+rr()*60|0},${.012+rr()*.028})`;g.fillRect(x,y,s,s);}
  g.fillStyle='rgba(22,30,40,.95)';g.fillRect(P(-1.7),0,P(1.7)-P(-1.7),h);g.fillRect(0,P(9.5),w,P(12.5)-P(9.5));
  g.strokeStyle='rgba(245,247,250,.16)';g.lineWidth=2;g.setLineDash([16,18]);g.beginPath();g.moveTo(512,0);g.lineTo(512,h);g.stroke();g.beginPath();g.moveTo(0,P(11));g.lineTo(w,P(11));g.stroke();g.setLineDash([]);
  [-PAD_X,PAD_X].forEach(px=>{const cx=P(px),cy=512,r=7.6*PX;const gr=g.createRadialGradient(cx,cy,0,cx,cy,r);gr.addColorStop(0,'rgba(120,136,152,.26)');gr.addColorStop(.85,'rgba(108,122,138,.18)');gr.addColorStop(1,'rgba(108,122,138,0)');g.fillStyle=gr;g.beginPath();g.arc(cx,cy,r,0,7);g.fill();
    g.strokeStyle='rgba(245,181,68,.38)';g.lineWidth=3;g.setLineDash([12,10]);g.beginPath();g.arc(cx,cy,6.3*PX,0,7);g.stroke();g.setLineDash([]);
    g.fillStyle='rgba(0,0,0,.55)';g.fillRect(cx-1.2*PX,cy-11*PX,2.4*PX,6.5*PX);});
  const e=g.createRadialGradient(512,512,300,512,512,512);e.addColorStop(0,'rgba(11,16,23,0)');e.addColorStop(1,'rgba(11,16,23,1)');g.fillStyle=e;g.fillRect(0,0,w,h);
},true);

/* ---------- sky dome + stars ---------- */
const skyU={uTime:{value:0},uFlash:{value:0},uGlow:{value:1}};
const skyMat=new T.ShaderMaterial({uniforms:skyU,side:T.BackSide,depthWrite:false,fog:false,
  vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform float uTime,uFlash,uGlow;varying vec3 vDir;${NOISE}
  void main(){vec3 d=normalize(vDir);float h=d.y;
    vec3 zen=vec3(.0032,.0050,.0090),mid=vec3(.0055,.0095,.0185),hor=vec3(.0135,.0225,.0420);
    vec3 c=mix(hor,mid,smoothstep(-.02,.16,h));c=mix(c,zen,smoothstep(.14,.72,h));
    float hz=exp(-max(h,0.)*8.);c+=vec3(.030,.012,.004)*hz*uGlow*(.5+.5*smoothstep(.3,-1.,d.z));
    vec3 bn=normalize(vec3(.35,.55,-.76));float band=exp(-pow(dot(d,bn)/.18,2.));
    vec2 sp=vec2(atan(d.x,d.z)*3.,d.y*6.);float cl=fbm(sp*2.2+3.)*fbm(sp*4.1+7.);
    c+=vec3(.010,.013,.021)*band*(.3+1.8*cl)*smoothstep(0.,.25,h);
    c=mix(c,vec3(.0016,.0022,.0032),smoothstep(0.,-.05,h));
    c+=vec3(1.,.92,.78)*uFlash*.05*smoothstep(-.1,.4,h);
    gl_FragColor=vec4(c,1.);${TONE}}`});
const skyGroup=new T.Group();scene.add(skyGroup);
const sky=new T.Mesh(new T.SphereGeometry(1800,48,24),skyMat);sky.renderOrder=-10;skyGroup.add(sky);
const STAR_N=3400;
const starGeo=new T.BufferGeometry();{const pos=new Float32Array(STAR_N*3),sz=new Float32Array(STAR_N*2),cc=new Float32Array(STAR_N*3);const rr=mulberry32(3);
  for(let i=0;i<STAR_N;i++){const y=Math.pow(rr(),.85),th=rr()*Math.PI*2,r=Math.sqrt(1-y*y);pos.set([Math.cos(th)*r*1500,y*1500+20,Math.sin(th)*r*1500],i*3);
    const big=rr()<.04;sz[i*2]=big?2.6+rr()*1.4:.9+rr()*1.3;sz[i*2+1]=rr();const k=rr();const c=k<.2?[.75,.85,1]:k<.3?[1,.85,.7]:[1,1,1];cc.set(c,i*3);}
  starGeo.setAttribute('position',new T.BufferAttribute(pos,3));starGeo.setAttribute('aS',new T.BufferAttribute(sz,2));starGeo.setAttribute('aCol',new T.BufferAttribute(cc,3));}
const starU={uTime:{value:0},uPR:{value:R.getPixelRatio()},uFade:{value:1}};
const stars=new T.Points(starGeo,new T.ShaderMaterial({uniforms:starU,...ADD,fog:false,
  vertexShader:`attribute vec2 aS;attribute vec3 aCol;uniform float uTime,uPR;varying vec3 vC;varying float vB;
  void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=aS.x*uPR;
    vB=(.62+.38*sin(uTime*(.6+aS.y*1.6)+aS.y*60.))*smoothstep(.0,.22,normalize(position).y);vC=aCol;}`,
  fragmentShader:`uniform float uFade;varying vec3 vC;varying float vB;void main(){float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,0.,d);gl_FragColor=vec4(vC*vB*a*a*.55*uFade,1.);${TONE}}`}));
stars.renderOrder=-9;skyGroup.add(stars);

/* ---------- ground, apron, hills ---------- */
const ground=new T.Mesh(new T.PlaneGeometry(2400,2400),new T.MeshLambertMaterial({color:col('#0B1017')}));
ground.rotation.x=-Math.PI/2;scene.add(ground);
const apron=new T.Mesh(new T.PlaneGeometry(140,140),new T.MeshLambertMaterial({map:groundTex}));
apron.rotation.x=-Math.PI/2;apron.position.y=.012;scene.add(apron);
{const segs=200,v=[],idx=[],rr=mulberry32(14),ph=[rr()*6,rr()*6,rr()*6,rr()*6];
  for(let i=0;i<=segs;i++){const a=i/segs*Math.PI*2,r=340+30*Math.sin(a*2+ph[0]);
    const hh=Math.max(1.5,4+9*Math.pow(Math.sin(a*3+ph[1])*.5+.5,2)+4*Math.sin(a*7+ph[2])+2*Math.sin(a*17+ph[3]));
    v.push(Math.cos(a)*r,-2,Math.sin(a)*r,Math.cos(a)*r,hh,Math.sin(a)*r);}
  for(let i=0;i<segs;i++){const k=i*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}
  const hg=new T.BufferGeometry();hg.setAttribute('position',new T.Float32BufferAttribute(v,3));hg.setIndex(idx);
  scene.add(new T.Mesh(hg,new T.MeshBasicMaterial({color:col('#04080D'),fog:false,side:T.DoubleSide})));}

/* ---------- lights ---------- */
const hemi=new T.HemisphereLight(col('#28486E'),col('#0B0806'),.85);scene.add(hemi);
const key=new T.DirectionalLight(col('#FFE6C8'),1.25);key.position.set(16,14,26);scene.add(key);
const rim=new T.DirectionalLight(col('#78AEFF'),1.05);rim.position.set(-14,24,-30);scene.add(rim);
const fireLight=[new T.PointLight(col('#FF8A3D'),0,60,1.6),new T.PointLight(col('#FF8A3D'),0,60,1.6)];
fireLight.forEach((l,i)=>{l.position.set(SIDE[i].side*PAD_X,1,0);scene.add(l);});

/* ---------- lamps: small glowing points (blink <= 1 Hz) ---------- */
const lampList=[];
function lamp(x,y,z,hex,size,mode_,phase,int){const c=col(hex);lampList.push([x,y,z,c.r,c.g,c.b,size,mode_||0,phase||0,int||1]);}
const lampU={uTime:{value:0},uScale:{value:500},uChase:{value:0}};
function buildLamps(){
  const n=lampList.length,pos=new Float32Array(n*3),cc=new Float32Array(n*3),pp=new Float32Array(n*4);
  lampList.forEach((l,i)=>{pos.set(l.slice(0,3),i*3);cc.set(l.slice(3,6),i*3);pp.set(l.slice(6,10),i*4);});
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('aCol',new T.BufferAttribute(cc,3));g.setAttribute('aP',new T.BufferAttribute(pp,4));
  const lamps=new T.Points(g,new T.ShaderMaterial({uniforms:lampU,...ADD,
    vertexShader:`attribute vec3 aCol;attribute vec4 aP;uniform float uTime,uScale,uChase;varying vec3 vC;varying float vB;
    void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;float b=aP.w;
      if(aP.y>.5&&aP.y<1.5){float s=fract(uTime+aP.z);b*=smoothstep(0.,.06,s)*(1.-smoothstep(.44,.5,s))+.04;}
      else if(aP.y>1.5&&aP.y<2.5){float s=fract(uTime*.8-aP.z);b*=mix(1.,.25+2.2*pow(max(0.,cos(s*6.2832)),10.),uChase);}
      else if(aP.y>2.5){b*=.35+.65*(.5+.5*sin(uTime*3.1416+aP.z*6.28));}
      vB=b;vC=aCol;gl_PointSize=clamp(aP.x*uScale/-mv.z,1.6,34.);}`,
    fragmentShader:`varying vec3 vC;varying float vB;void main(){float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,0.,d);a=a*a*(.6+.4*smoothstep(.35,0.,d));gl_FragColor=vec4(vC*vB*a*2.6,1.);${TONE}}`}));
  lamps.frustumCulled=false;scene.add(lamps);
}

/* ---------- shared materials ---------- */
const concrete=new T.MeshStandardMaterial({color:col('#2B3540'),roughness:.92,metalness:.04});
const steelDark=new T.MeshStandardMaterial({color:col('#1C2531'),roughness:.5,metalness:.62});
const gantryMat=new T.MeshStandardMaterial({color:col('#2C3846'),roughness:.58,metalness:.55,emissive:col('#05090E')});
const boxGeo=new T.BoxGeometry(1,1,1);

/* ---------- additive helpers: glow sprite, light pool, beam cone ---------- */
function glowSprite(hex,size,op,own){const m=new T.SpriteMaterial({map:glowTex,color:col(hex),...ADD,opacity:op==null?1:op,fog:false});if(own)own.push(m);const s=new T.Sprite(m);s.scale.set(size,size,1);return s;}
const poolGeo=new T.PlaneGeometry(1,1);
function lightPool(x,z,size,hex,op){const m=new T.MeshBasicMaterial({map:glowTex,color:col(hex),...ADD,opacity:op,fog:true});const p=new T.Mesh(poolGeo,m);p.rotation.x=-Math.PI/2;p.position.set(x,.05,z);p.scale.set(size,size,1);scene.add(p);return p;}
const beamVS=`uniform float uLen;varying float vL;varying vec3 vN;varying vec3 vV;
void main(){vL=-position.y/uLen;vec4 wp=modelMatrix*vec4(position,1.);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-wp.xyz);gl_Position=projectionMatrix*viewMatrix*wp;}`;
const beamFS=`uniform vec3 uColor;uniform float uOpacity;varying float vL;varying vec3 vN;varying vec3 vV;
void main(){float f=abs(dot(normalize(vN),normalize(vV)));float a=pow(f,2.4)*pow(1.-vL,1.5)*smoothstep(0.,.05,vL);gl_FragColor=vec4(uColor*a*uOpacity,1.);${TONE}}`;
function beamCone(len,radius,hex,op){
  const g=new T.ConeGeometry(radius,len,32,1,true);g.translate(0,-len/2,0);
  const m=new T.ShaderMaterial({uniforms:{uLen:{value:len},uColor:{value:col(hex)},uOpacity:{value:op}},vertexShader:beamVS,fragmentShader:beamFS,...ADD,side:T.DoubleSide});
  const mesh=new T.Mesh(g,m);mesh.frustumCulled=false;return mesh;
}
const DOWN=new V3(0,-1,0);
function aim(mesh,dir){mesh.quaternion.setFromUnitVectors(DOWN,dir);}

/* ---------- pads ---------- */
const padGlow=[];
SIDE.forEach((c)=>{
  const x=c.side*PAD_X,g=new T.Group();g.position.set(x,0,0);
  const base=new T.Mesh(new T.CylinderGeometry(4.0,4.5,1.2,8),concrete);base.position.y=.6;base.rotation.y=Math.PI/8;g.add(base);
  const deck=new T.Mesh(new T.CylinderGeometry(3.0,3.15,.26,40),steelDark);deck.position.y=1.32;g.add(deck);
  const ring_=new T.Mesh(new T.TorusGeometry(1.08,.13,10,44),steelDark);ring_.rotation.x=Math.PI/2;ring_.position.y=PAD_TOP+.02;g.add(ring_);
  for(let k=0;k<4;k++){const a=k/4*Math.PI*2+Math.PI/4,p=new T.Mesh(boxGeo,steelDark);p.scale.set(.22,.62,.22);p.position.set(Math.cos(a)*1.16,PAD_TOP+.3,Math.sin(a)*1.16);g.add(p);}
  scene.add(g);
  for(let k=0;k<12;k++){const a=k/12*Math.PI*2;lamp(x+Math.cos(a)*4.32,1.24,Math.sin(a)*4.32,'#F5B544',.34,2,k/12,.9);}
  const deckPool=new T.Mesh(poolGeo,new T.MeshBasicMaterial({map:glowTex,color:col('#FF7A2E'),...ADD,opacity:0}));deckPool.rotation.x=-Math.PI/2;deckPool.position.set(x,PAD_TOP+.03,0);deckPool.scale.set(9,9,1);scene.add(deckPool);
  const groundPool=lightPool(x,0,34,'#FF6A1E',0);
  padGlow.push({deckPool,groundPool});
  lightPool(x,0,15,'#9FB8D6',.10);
});

/* ---------- gantries with swing-away service arms ---------- */
const gantries=SIDE.map((c,i)=>{
  const side=c.side,gx=side*(PAD_X+3.35),Hh=12.8,W=1.7,g=new T.Group();g.position.set(gx,0,-.15);
  const beams=[];const add=(x,y,z,sx,sy,sz,rx,rz)=>beams.push([x,y,z,sx,sy,sz,rx||0,rz||0]);
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>add(a*W/2,Hh/2,b*W/2,.14,Hh,.14));
  const dy=1.16;
  for(let y=.9;y<Hh-.2;y+=dy){
    add(0,y,-W/2,W,.09,.09);add(0,y,W/2,W,.09,.09);add(-W/2,y,0,.09,.09,W);add(W/2,y,0,.09,.09,W);
    const L=Math.hypot(W,dy),ang=Math.atan2(dy,W);
    add(0,y+dy/2,W/2,L,.06,.06,0,ang);add(0,y+dy/2,W/2,L,.06,.06,0,-ang);
    add(-W/2,y+dy/2,0,.06,.06,L,ang,0);add(W/2,y+dy/2,0,.06,.06,L,-ang,0);
  }
  const im=new T.InstancedMesh(boxGeo,gantryMat,beams.length),m4=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler();
  beams.forEach((b,k)=>{e.set(b[6],0,b[7]);q.setFromEuler(e);m4.compose(new V3(b[0],b[1],b[2]),q,new V3(b[3],b[4],b[5]));im.setMatrixAt(k,m4);});
  g.add(im);
  const top=new T.Mesh(boxGeo,steelDark);top.scale.set(W+.5,.18,W+.5);top.position.y=Hh;g.add(top);
  const mast=new T.Mesh(new T.CylinderGeometry(.05,.09,3,6),steelDark);mast.position.y=Hh+1.5;g.add(mast);
  const arms=[];
  [[.46,false],[.8,true]].forEach(([f,room])=>{
    const y=PAD_TOP+DEMO_CREW[i].len*f,len=3.35-W/2-DEMO_CREW[i].rad-.05,pv=new T.Group();pv.position.set(-side*W/2,y,.25);
    const arm=new T.Mesh(boxGeo,gantryMat);arm.scale.set(len,.22,.55);arm.position.x=-side*len/2;pv.add(arm);
    if(room){const wr=new T.Mesh(boxGeo,concrete);wr.scale.set(.75,.95,.95);wr.position.x=-side*(len-.3);pv.add(wr);lamp(gx-side*W/2-side*(len-.3),y+.55,.25+.5,'#FFE2B0',.22,0,0,.7);}
    g.add(pv);arms.push(pv);
  });
  scene.add(g);
  lamp(gx,Hh+3.05,-.15,'#EF4444',1.0,1,i*.5,1.2);lamp(gx+side*W/2,Hh*.55,.75,'#EF4444',.7,1,i*.5+.25,1);
  for(let y=1.6;y<Hh;y+=2.3){lamp(gx-side*W/2,y,.8,'#FFE2B0',.26,0,0,.75);}
  return {group:g,arms};
});
const armsT=[-1,-1];

/* ---------- floodlight towers ---------- */
const floods=[[-19,9,0],[19,9,1],[-15,-13,0],[15,-13,1]].map(([x,z,s])=>{
  const g=new T.Group();g.position.set(x,0,z);
  const pole=new T.Mesh(new T.CylinderGeometry(.12,.2,13,8),steelDark);pole.position.y=6.5;g.add(pole);
  const tgt=new V3(SIDE[s].side*PAD_X,5.5,0),head=new V3(x,13.2,z),dir=tgt.clone().sub(head).normalize();
  const hb=new T.Mesh(boxGeo,steelDark);hb.scale.set(1.9,1.0,.4);hb.position.y=13.2;hb.lookAt(tgt.x,tgt.y,tgt.z);g.add(hb);
  const face=new T.Mesh(new T.PlaneGeometry(1.7,.85),new T.MeshBasicMaterial({color:new T.Color(5,4.6,4.1)}));face.position.copy(hb.position);face.lookAt(tgt.x,tgt.y,tgt.z);face.translateZ(.22);g.add(face);
  scene.add(g);
  const sp=glowSprite('#FFE7C4',4.6,.75);sp.position.copy(head);scene.add(sp);
  const cone=beamCone(26,5.2,'#FFE2BC',.11);cone.position.copy(head);aim(cone,dir);scene.add(cone);
  lightPool(tgt.x+(x-tgt.x)*.15,(z+tgt.z)/2*.4,26,'#FFDCB0',.06);
  return {cone,sprite:sp,s,lit:1};
});

/* ---------- searchlights sweeping the fog ---------- */
const searches=[-52,-26,0,26,52].map((x,i)=>{
  const base=new V3(x,0,-58-(i%2)*8),cone=beamCone(190,9.5,'#CFE6FF',.06);cone.position.copy(base);scene.add(cone);
  lamp(base.x,.8,base.z,'#CFE6FF',2.6,0,0,1.3);
  const d=new V3(Math.sin(i*1.7)*.3,1,.08).normalize();aim(cone,d);
  return {cone,base,dir:d,tdir:d.clone(),ph:i*1.37,sp:.11+.03*i,mode:'sweep',tgt:null};
});

/* ---------- procedural rockets (a mission's ship from its genome) ---------- */
function panelTex(accent,seed,windows,base,list){
  return canvasTex(256,512,(g,w,h)=>{
    const rr=mulberry32(seed);g.fillStyle=base||'#D3DAE2';g.fillRect(0,0,w,h);
    for(let x=0;x<w;x+=32){g.fillStyle=`rgba(${110+rr()*50|0},${122+rr()*50|0},${140+rr()*50|0},${.04+rr()*.07})`;g.fillRect(x,0,32,h);}
    g.fillStyle='rgba(38,50,64,.42)';for(let y=0;y<h;y+=64)g.fillRect(0,y,w,2);
    for(let y=0;y<h;y+=64){const off=(y/64)%2?16:0;for(let x=off;x<w;x+=64)g.fillRect(x,y,1.5,64);}
    g.fillStyle='rgba(38,50,64,.28)';for(let y=0;y<h;y+=64)for(let x=0;x<w;x+=8)g.fillRect(x,y+5,1.5,1.5);
    if(!windows){for(let i=0;i<4;i++){g.fillStyle=i%2?(base||'#D3DAE2'):'#18212D';g.fillRect(i*w/4,h*.1,w/4,40);}
      g.fillStyle=accent;g.fillRect(w*.56,h*.28,12,h*.46);g.fillRect(w*.06,h*.28,12,h*.46);}
    const gr=g.createLinearGradient(0,h*.72,0,h);gr.addColorStop(0,'rgba(34,26,20,0)');gr.addColorStop(1,'rgba(34,26,20,.42)');g.fillStyle=gr;g.fillRect(0,h*.72,w,h*.28);
  },true,list);
}
function windowTex(accent,list){return canvasTex(128,256,(g,w,h)=>{g.fillStyle='#000';g.fillRect(0,0,w,h);g.fillStyle=accent;
  for(let i=0;i<3;i++){g.fillRect(w*.18+i*14,h*.3,8,11);}for(let i=0;i<3;i++){g.fillRect(w*.68+i*14,h*.3,8,11);}g.fillRect(0,h*.62,w,5);},true,list);}
const flameVS=`varying float vL;varying vec3 vN;varying vec3 vV;varying vec3 vP;
void main(){vL=-position.y;vP=position;vec4 wp=modelMatrix*vec4(position,1.);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-wp.xyz);gl_Position=projectionMatrix*viewMatrix*wp;}`;
const flameFS=`uniform float uTime,uI,uSeed,uDia;uniform vec3 uC0,uC1,uC2,uC3,uC4;varying float vL;varying vec3 vN;varying vec3 vV;varying vec3 vP;${NOISE}
void main(){float f=abs(dot(normalize(vN),normalize(vV)));
  float n=fbm(vec2(vP.x*2.6+vP.z*1.9+uSeed,vL*3.4-uTime*7.5));
  float x=clamp(vL*1.05+(n-.5)*.34,0.,1.);
  vec3 c=x<.12?mix(uC0,uC1,x/.12):x<.4?mix(uC1,uC2,(x-.12)/.28):x<.7?mix(uC2,uC3,(x-.4)/.3):mix(uC3,uC4,(x-.7)/.3);
  float a=pow(f,1.25)*(1.-smoothstep(.5,1.,vL+(n-.5)*.42))*(.55+.9*n);
  float dia=(1.-smoothstep(0.,.42,vL))*pow(.5+.5*cos(vL*44.),8.)*uDia;
  gl_FragColor=vec4((c*a*(1.05+dia*1.3)+dia*a*vec3(1.,.8,.5)*.6)*uI,1.);${TONE}}`;
const FIRE=['#FDB43A','#FC9D01','#FC5501','#FA260F','#F30D1D'].map(col);
const CORE=['#FFF6E0','#FFD27A','#FC9D01','#FC5501','#FA260F'].map(col);
const flameGeo=(()=>{const prof=[[0,-1],[.16,-.95],[.42,-.84],[.72,-.68],[.98,-.5],[1.16,-.32],[1.22,-.16],[1.12,-.06],[.95,0]];return new T.LatheGeometry(prof.map(p=>new T.Vector2(p[0],p[1])),36,0,Math.PI*2);})();
function flameMat(stops,seed,dia){return new T.ShaderMaterial({uniforms:{uTime:{value:0},uI:{value:0},uSeed:{value:seed},uDia:{value:dia},uC0:{value:stops[0]},uC1:{value:stops[1]},uC2:{value:stops[2]},uC3:{value:stops[3]},uC4:{value:stops[4]}},vertexShader:flameVS,fragmentShader:flameFS,...ADD});}
const bellMat=new T.MeshStandardMaterial({color:col('#3B4452'),roughness:.32,metalness:.88,side:T.DoubleSide});
const finMat=new T.MeshStandardMaterial({color:col('#222C38'),roughness:.45,metalness:.5});
const noseMat=new T.MeshStandardMaterial({color:col('#EEF2F6'),roughness:.38,metalness:.22});
const darkBand=new T.MeshStandardMaterial({color:col('#18212C'),roughness:.5,metalness:.5});
function arcY(x){return Y_ORBIT-ORBIT_LINE_R+Math.sqrt(ORBIT_LINE_R*ORBIT_LINE_R-x*x);}
function buildRocket(i,spec){
  const own=[],O=(x)=>{own.push(x);return x;};
  const c={side:SIDE[i].side,color:spec.accent,len:spec.len,rad:spec.rad,fins:spec.fins,seed:spec.seed};
  const r=c.rad,L=c.len,acc=col(c.color),root3=new T.Group(),body=new T.Group();root3.add(body);body.position.y=-L/2;
  const bellH=.62,bellR=r*.8,b1=L*.5,inter=.22,b2=L*.19,noseH=L-bellH-b1-inter-b2;
  const bell=new T.Mesh(O(new T.LatheGeometry([[bellR,0],[bellR*.86,bellH*.35],[bellR*.68,bellH*.75],[bellR*.6,bellH]].map(p=>new T.Vector2(p[0],p[1])),28)),bellMat);body.add(bell);
  const heat=new T.Mesh(O(new T.CircleGeometry(bellR*.92,28)),O(new T.MeshBasicMaterial({color:col('#FF9A3C'),...ADD,opacity:0,side:T.DoubleSide})));heat.rotation.x=Math.PI/2;heat.position.y=.04;body.add(heat);
  const matA=O(new T.MeshStandardMaterial({map:panelTex(c.color,c.seed,false,spec.base,own),roughness:.42,metalness:.26}));
  const lower=new T.Mesh(O(new T.CylinderGeometry(r,r*1.02,b1,48,1,true)),matA);lower.position.y=bellH+b1/2;body.add(lower);
  const skirt=new T.Mesh(O(new T.CylinderGeometry(r*1.04,r*1.07,.26,48,1,true)),darkBand);skirt.position.y=bellH+.13;body.add(skirt);
  const bandMat=O(new T.MeshStandardMaterial({color:acc,emissive:acc,emissiveIntensity:2.4,roughness:.4,metalness:.2}));
  const band=new T.Mesh(O(new T.CylinderGeometry(r*1.018,r*1.018,.34,48,1,true)),bandMat);band.position.y=bellH+b1-.55;body.add(band);
  const band2=band.clone();band2.scale.y=.4;band2.position.y=bellH+.5;body.add(band2);
  const it=new T.Mesh(O(new T.CylinderGeometry(r*.96,r,inter,48,1,true)),darkBand);it.position.y=bellH+b1+inter/2;body.add(it);
  const matB=O(new T.MeshStandardMaterial({map:panelTex(c.color,c.seed+7,true,spec.base,own),roughness:.4,metalness:.24,emissive:0xffffff,emissiveMap:windowTex(c.color,own),emissiveIntensity:2.2}));
  const upper=new T.Mesh(O(new T.CylinderGeometry(r*.94,r*.96,b2,48,1,true)),matB);upper.position.y=bellH+b1+inter+b2/2;body.add(upper);
  const nExp=.4+.44*clamp(spec.nose==null?.5:spec.nose,0,1);
  const np=[];for(let k=0;k<=12;k++){const t=k/12;np.push(new T.Vector2(Math.max(.001,r*.94*Math.pow(1-t*t,nExp)),t*noseH));}
  const nose=new T.Mesh(O(new T.LatheGeometry(np,48)),noseMat);nose.position.y=bellH+b1+inter+b2;body.add(nose);
  const tip=new T.Mesh(O(new T.ConeGeometry(r*.16,noseH*.16,16)),darkBand);tip.position.y=bellH+b1+inter+b2+noseH*.93;body.add(tip);
  const span=r*(c.fins===3?1.25:1.05),rootC=L*.2,tipC=L*.085;
  const fs=new T.Shape();fs.moveTo(0,0);fs.lineTo(span,-.25);fs.lineTo(span,-.25+tipC);fs.lineTo(0,rootC);fs.lineTo(0,0);
  const fg=O(new T.ExtrudeGeometry(fs,{depth:.075,bevelEnabled:false}));fg.translate(0,0,-.0375);
  const edgeMat=O(new T.MeshStandardMaterial({color:acc,emissive:acc,emissiveIntensity:2.0}));
  const fin0=c.fins===4?Math.PI/4:Math.PI/2;
  for(let k=0;k<c.fins;k++){const a=k/c.fins*Math.PI*2+fin0;
    const f=new T.Group();f.rotation.y=-a;f.position.set(Math.cos(a)*r*.97,bellH+.05,Math.sin(a)*r*.97);
    f.add(new T.Mesh(fg,finMat));const eg=new T.Mesh(boxGeo,edgeMat);eg.scale.set(.05,tipC*.9,.09);eg.position.set(span+.02,-.25+tipC/2,0);f.add(eg);body.add(f);}
  const fo=new T.Mesh(flameGeo,O(flameMat(FIRE,i*3.1,.9)));fo.renderOrder=6;fo.visible=false;body.add(fo);
  const fc=new T.Mesh(flameGeo,O(flameMat(CORE,i*5.7+1,.4)));fc.renderOrder=7;fc.visible=false;body.add(fc);
  const nGlow=glowSprite('#FF8A3D',6,0,own);nGlow.position.y=-.5;body.add(nGlow);nGlow.renderOrder=8;
  const streak=new T.Sprite(O(new T.SpriteMaterial({map:streakTex,color:col('#FFB070'),...ADD,opacity:0,fog:false})));streak.scale.set(16,.5,1);streak.position.y=-.4;body.add(streak);streak.renderOrder=8;
  const halo=new T.Mesh(O(new T.TorusGeometry(r*2.3,.06,8,64)),O(new T.MeshBasicMaterial({color:acc.clone().multiplyScalar(3),...ADD,opacity:0})));halo.rotation.x=Math.PI/2;halo.position.y=0;root3.add(halo);
  /* LIVE ships: boosters follow altitude (25 / 50 / 75 %), wings in orbit, a ring for every passed day check */
  const bst=[],wings=[],dayRings=[];
  if(spec.extras){
    const bH=L*.3,bR=r*.26,bGeo=O(new T.CylinderGeometry(bR,bR*1.06,bH,20)),bNose=O(new T.ConeGeometry(bR,bH*.24,20)),bRing=O(new T.CylinderGeometry(bR*1.04,bR*1.04,.12,20,1,true));
    const bMat=O(new T.MeshStandardMaterial({color:col(spec.base),roughness:.45,metalness:.3}));
    for(let k=0;k<3;k++){const a=fin0+(k+.5)*(Math.PI*2/c.fins);
      const g=new T.Group();g.position.set(Math.cos(a)*r*1.24,bellH+L*.08+bH/2,Math.sin(a)*r*1.24);
      g.add(new T.Mesh(bGeo,bMat));const nc=new T.Mesh(bNose,bMat);nc.position.y=bH/2+bH*.12;g.add(nc);
      const br=new T.Mesh(bRing,bandMat);br.position.y=-bH*.28;g.add(br);
      g.scale.setScalar(.001);g.visible=false;body.add(g);bst.push({g,s:0});}
    const ws=new T.Shape();ws.moveTo(0,0);ws.lineTo(r*1.7,-L*.05);ws.lineTo(r*1.7,L*.03);ws.lineTo(0,L*.2);ws.lineTo(0,0);
    const wg=O(new T.ExtrudeGeometry(ws,{depth:.06,bevelEnabled:false}));wg.translate(0,0,-.03);
    [0,Math.PI].forEach(ry=>{const w=new T.Group();w.position.y=bellH+b1*.42;w.rotation.y=ry;const wm=new T.Mesh(wg,edgeMat);wm.position.x=r*.95;w.add(wm);w.scale.setScalar(.001);w.visible=false;body.add(w);wings.push(w);});
    for(let k=0;k<3;k++){const dr=new T.Mesh(O(new T.TorusGeometry(r*1.75+k*.38,.035,6,64)),O(new T.MeshBasicMaterial({color:acc.clone().multiplyScalar(2.2),...ADD,opacity:0})));dr.rotation.x=Math.PI/2;dr.position.y=-L*.12;dr.visible=false;root3.add(dr);dayRings.push(dr);}
  }
  root3.position.set(c.side*PAD_X,PAD_TOP+L/2,0);
  body.rotation.y=-c.side*.5;
  scene.add(root3);
  return {c,i,root:root3,body,fo,fc,nGlow,streak,heat,halo,bellR,L,own,key:'',extras:!!spec.extras,bst,wings,dayRings,alive:0,wingS:0,
    a:0,thrust:0,burst:0,dip:0,orbitT:-1,ang:0,drift:0,ins0:new V3(),pendingOrbit:false,orbitVisual:false,goldT:-9,
    climb:arcY(c.side*PAD_X)-(PAD_TOP+L/2)};
}
function freeRocket(rk){scene.remove(rk.root);rk.own.forEach(x=>{try{x.dispose();}catch(_e){/* already gone */}});rk.own.length=0;}
function resetRocket(rk){
  Object.assign(rk,{a:0,thrust:0,burst:0,dip:0,orbitT:-1,pendingOrbit:false,orbitVisual:false,drift:0,goldT:-9,wingS:0});
  rk.halo.material.opacity=0;rk.root.rotation.z=0;rk.root.position.set(rk.c.side*PAD_X,PAD_TOP+rk.L/2,0);
  rk.bst.forEach(b=>{b.s=0;b.g.visible=false;b.g.scale.setScalar(.001);});rk.wings.forEach(w=>{w.visible=false;w.scale.setScalar(.001);});
  rk.dayRings.forEach(d=>{d.material.opacity=0;d.visible=false;});
}
const rockets=[buildRocket(0,DEMO_CREW[0]),buildRocket(1,DEMO_CREW[1])];
rockets.forEach(rk=>{rk.root.visible=false;});

/* ---------- GPU particles (instanced billboards, ring buffer) ---------- */
const partVS=`attribute vec4 aP0;attribute vec4 aV;attribute vec4 aS;attribute vec4 aC;
uniform float uTime;uniform vec4 uFl0,uFl1;uniform vec3 uAmb;
varying vec2 vUv;varying float vAge,vKind,vA;varying vec3 vLit;
void main(){float tt=uTime-aP0.w;float age=tt/aV.w;
  if(age<0.||age>1.){gl_Position=vec4(0.,0.,-2.,1.);vAge=1.;return;}
  float k=aS.z;vec3 disp=k>0.?aV.xyz*(1.-exp(-k*tt))/k:aV.xyz*tt;
  vec3 p=aP0.xyz+disp+vec3(0.,.5*aC.y*tt*tt,0.);
  float sm=step(2.5,aC.x);p.x+=sin(tt*.9+aS.w*6.28)*.3*tt*sm;p.z+=cos(tt*.8+aS.w*9.)*.3*tt*sm;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  float sz=mix(aS.x,aS.y,1.-pow(1.-age,2.));float rot=aS.w*6.28+tt*aC.w;
  vec2 cr=position.xy;cr=vec2(cr.x*cos(rot)-cr.y*sin(rot),cr.x*sin(rot)+cr.y*cos(rot));mv.xy+=cr*sz;
  gl_Position=projectionMatrix*mv;vUv=uv;vAge=age;vKind=aC.x;vA=aC.z;
  float d0=distance(p,uFl0.xyz),d1=distance(p,uFl1.xyz);
  vLit=uAmb+vec3(1.,.45,.14)*(uFl0.w*3.2/(1.+d0*d0*.11)+uFl1.w*3.2/(1.+d1*d1*.11));}`;
const partFS=`uniform sampler2D uMap;varying vec2 vUv;varying float vAge,vKind,vA;varying vec3 vLit;
void main(){vec2 c=vUv-.5;float r=length(c)*2.;vec4 o;
  if(vKind<.5){float a=smoothstep(1.,0.,r);a*=a;vec3 f=mix(vec3(1.,.6,.16),vec3(.95,.09,.02),smoothstep(0.,.6,vAge));o=vec4(f*a*(1.-vAge)*1.5*vA,1.);}
  else if(vKind<1.5){float a=pow(smoothstep(1.,0.,r),3.);o=vec4(vec3(1.,.72,.32)*a*(1.-vAge)*4.5*vA,1.);}
  else if(vKind<2.5){float a=pow(smoothstep(1.,0.,r),2.5);o=vec4(vec3(1.,.74,.26)*a*(1.-vAge*vAge)*4.*vA,1.);}
  else{float m=texture2D(uMap,vUv).a;float fade=smoothstep(0.,.07,vAge)*(1.-smoothstep(.5,1.,vAge));
    vec3 b=vKind<3.5?vec3(.30,.32,.36):vKind<4.5?vec3(.30,.32,.36):vec3(.62,.66,.72);o=vec4(b*vLit,m*fade*vA);}
  gl_FragColor=o;${TONE}}`;
const partU={uTime:{value:0},uFl0:{value:new T.Vector4()},uFl1:{value:new T.Vector4()},uAmb:{value:col('#3E4E66')},uMap:{value:smokeTex}};
function makeParticles(max,additive,order){
  const base=new T.PlaneGeometry(1,1),g=new T.InstancedBufferGeometry();g.setIndex(base.index);g.setAttribute('position',base.attributes.position);g.setAttribute('uv',base.attributes.uv);
  const arr=[0,1,2,3].map(()=>new Float32Array(max*4));for(let i=0;i<max;i++){arr[0][i*4+3]=-1e4;arr[1][i*4+3]=1;}
  const at=arr.map(a=>{const b=new T.InstancedBufferAttribute(a,4);b.setUsage(T.DynamicDrawUsage);return b;});
  ['aP0','aV','aS','aC'].forEach((n,k)=>g.setAttribute(n,at[k]));g.instanceCount=max;
  const m=new T.ShaderMaterial({uniforms:partU,vertexShader:partVS,fragmentShader:partFS,transparent:true,depthWrite:false,blending:additive?T.AdditiveBlending:T.NormalBlending});
  const mesh=new T.Mesh(g,m);mesh.frustumCulled=false;mesh.renderOrder=order;scene.add(mesh);
  return {arr,at,max,cur:0,lo:1e9,hi:-1,wrap:false,cap:max,
    emit(x,y,z,vx,vy,vz,life,s0,s1,drag,kind,grav,alpha,spin){
      const i=this.cur,k=i*4,A=this.arr,t=partU.uTime.value;this.cur++;if(this.cur>=this.cap){this.cur=0;this.wrap=true;}
      A[0][k]=x;A[0][k+1]=y;A[0][k+2]=z;A[0][k+3]=t;A[1][k]=vx;A[1][k+1]=vy;A[1][k+2]=vz;A[1][k+3]=life;
      A[2][k]=s0;A[2][k+1]=s1;A[2][k+2]=drag;A[2][k+3]=Math.random();A[3][k]=kind;A[3][k+1]=grav;A[3][k+2]=alpha;A[3][k+3]=spin||0;
      if(i<this.lo)this.lo=i;if(i>this.hi)this.hi=i;},
    flush(){if(this.hi<0&&!this.wrap)return;for(const b of this.at){if(this.wrap){b.updateRange.offset=0;b.updateRange.count=-1;}else{b.updateRange.offset=this.lo*4;b.updateRange.count=(this.hi-this.lo+1)*4;}b.needsUpdate=true;}this.lo=1e9;this.hi=-1;this.wrap=false;},
    kill(){for(let i=0;i<this.max;i++)this.arr[0][i*4+3]=-1e4;this.wrap=true;this.flush();}};
}
const smokeP=makeParticles(1700,false,3),fireP=makeParticles(1900,true,5);
const rnd=(a,b)=>a+Math.random()*(b-a);

/* ---------- crowd ring: thousands of phone lights, pulse per side on buys ---------- */
const CROWD_MAX=7200;
const crowdGeo=new T.BufferGeometry();{const pos=new Float32Array(CROWD_MAX*3),aI=new Float32Array(CROWD_MAX*4),rr=mulberry32(21);
  for(let i=0;i<CROWD_MAX;i++){const a=rr()*Math.PI*2,t=Math.pow(rr(),.8),x=Math.cos(a)*(23+t*14),z=Math.sin(a)*(18+t*11)+1.5,y=.35+t*3.4+rr()*.55;
    pos.set([x,y,z],i*3);const s=x<0?-1:1,k=rr();aI.set([rr(),s,Math.hypot(x-s*PAD_X,z),k<.36?1:k<.76?0:2],i*4);}
  crowdGeo.setAttribute('position',new T.BufferAttribute(pos,3));crowdGeo.setAttribute('aI',new T.BufferAttribute(aI,4));}
const crowdU={uTime:{value:0},uScale:{value:500},uFlare:{value:0},uGold:{value:new T.Vector2()},uColE:{value:col('#4FB8FF')},uColT:{value:col('#F5B544')},
  uPulseL:{value:[new T.Vector4(-99),new T.Vector4(-99),new T.Vector4(-99)]},uPulseR:{value:[new T.Vector4(-99),new T.Vector4(-99),new T.Vector4(-99)]}};
const crowd=new T.Points(crowdGeo,new T.ShaderMaterial({uniforms:crowdU,...ADD,
  vertexShader:`attribute vec4 aI;uniform float uTime,uScale,uFlare;uniform vec2 uGold;uniform vec3 uColE,uColT;uniform vec4 uPulseL[3];uniform vec4 uPulseR[3];varying vec3 vC;varying float vB;
  void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
    float tw=.5+.5*sin(uTime*(.45+aI.x*1.6)+aI.x*80.);float ring=0.;
    for(int k=0;k<3;k++){vec4 P=aI.y<0.?uPulseL[k]:uPulseR[k];float tau=uTime-P.x;if(tau>0.&&tau<2.6){ring+=exp(-pow((aI.z-tau*P.z)/3.4,2.))*P.y*exp(-tau*1.25);}}
    float gold=aI.y<0.?uGold.x:uGold.y;
    float b=(.2+.26*tw+ring*1.6+uFlare*(.6+.7*aI.x)+gold*.5)*smoothstep(7.,24.,-mv.z);
    vec3 base=aI.w<.5?vec3(1.,.84,.62):aI.w<1.5?(aI.y<0.?uColE:uColT):vec3(.72,.84,1.);
    vC=mix(base,vec3(1.,.72,.28),gold*.8);vB=b;
    gl_PointSize=clamp((.085+ring*.05+uFlare*.06+gold*.03)*uScale/-mv.z,1.,4.6)*(.8+.4*aI.x);}`,
  fragmentShader:`varying vec3 vC;varying float vB;void main(){float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.15,d);gl_FragColor=vec4(vC*vB*a*1.7,1.);${TONE}}`}));
crowd.frustumCulled=false;scene.add(crowd);
const pulseIdx=[0,0];
function crowdPulse(s,amp){const v=(s===0?crowdU.uPulseL:crowdU.uPulseR).value[pulseIdx[s]++%3];v.set(clock,amp,24,0);}

/* ---------- the orbit line: glowing arc = finish line ---------- */
const ORBIT_LINE_SPAN=1.25,ORBIT_LINE_C=new V3(0,Y_ORBIT-ORBIT_LINE_R,ORBIT_LINE_Z),ORBIT_LINE_LEN=2*ORBIT_LINE_SPAN*ORBIT_LINE_R;
class OrbitLineCurve extends T.Curve{getPoint(t,o){o=o||new V3();const a=(t-.5)*2*ORBIT_LINE_SPAN;return o.set(ORBIT_LINE_C.x+Math.sin(a)*ORBIT_LINE_R,ORBIT_LINE_C.y+Math.cos(a)*ORBIT_LINE_R,ORBIT_LINE_C.z);}}
const uOfX=(x)=>Math.asin(clamp(x/ORBIT_LINE_R,-1,1))/(2*ORBIT_LINE_SPAN)+.5;
const arcU={uTime:{value:0},uWaveT:{value:-1},uWaveU:{value:.5},uWaveA:{value:1},uI:{value:.32},uCharge:{value:0},uCol:{value:col('#4FB8FF')},uGold:{value:col('#F5B544')}};
const arcVS=`varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){vUv=uv;vec4 wp=modelMatrix*vec4(position,1.);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-wp.xyz);gl_Position=projectionMatrix*viewMatrix*wp;}`;
const arcFS=`uniform float uTime,uWaveT,uWaveU,uWaveA,uI,uCharge,uHalo;uniform vec3 uCol,uGold;varying vec2 vUv;varying vec3 vN;varying vec3 vV;
void main(){float f=abs(dot(normalize(vN),normalize(vV)));float u=vUv.x;
  float flow=.5+.5*pow(.5+.5*sin(u*220.-uTime*1.8),5.);float ends=smoothstep(0.,.1,u)*smoothstep(1.,.9,u);
  float d=abs(u-uWaveU)*${ORBIT_LINE_LEN.toFixed(2)};float w=0.;
  if(uWaveT>=0.){float fr=uWaveT*62.;w=(exp(-pow((d-fr)/4.5,2.))*exp(-uWaveT*.55)*2.4+exp(-d*.12)*exp(-uWaveT*1.4)*2.)*uWaveA;}
  float a=uHalo>.5?pow(f,2.4)*.3:pow(f,.5);
  vec3 c=uCol*(uI*flow+uCharge)+uGold*w*(uHalo>.5?1.4:2.6)+vec3(1.)*w*.5*(1.-uHalo);
  gl_FragColor=vec4(c*a*ends,1.);${TONE}}`;
const orbitLineCurve=new OrbitLineCurve();
[[.11,0,600],[.75,1,300]].forEach(([rad,halo,seg])=>{const m=new T.Mesh(new T.TubeGeometry(orbitLineCurve,seg,rad,8,false),new T.ShaderMaterial({uniforms:Object.assign({},arcU,{uHalo:{value:halo}}),vertexShader:arcVS,fragmentShader:arcFS,...ADD}));m.renderOrder=4;m.frustumCulled=false;scene.add(m);});

/* ---------- ping rings (buys) and shockwave rings (orbit) ---------- */
const ringGeo=new T.RingGeometry(.9,1,96),rings=[];let ringIdx=0;
for(let k=0;k<24;k++){const me=new T.Mesh(ringGeo,new T.MeshBasicMaterial({color:new T.Color(),...ADD,opacity:0,side:T.DoubleSide,fog:false}));me.visible=false;me.renderOrder=9;scene.add(me);rings.push({me,t0:0,life:1,s0:1,s1:3,live:false,flat:true});}
function ring(p,hex,mult,s0,s1,life,flat){const r=rings[ringIdx++%rings.length];r.me.position.copy(p);r.me.material.color.copy(col(hex)).multiplyScalar(mult);r.me.rotation.set(flat?-Math.PI/2:0,0,0);Object.assign(r,{t0:clock,life,s0,s1,live:true,flat});r.me.visible=true;}
function updateRings(){for(const r of rings){if(!r.live)continue;const p=(clock-r.t0)/r.life;if(p>=1){r.live=false;r.me.visible=false;continue;}
  r.me.scale.setScalar(lerp(r.s0,r.s1,EZ.out(p)));r.me.material.opacity=Math.pow(1-p,1.6)*.95;if(!r.flat)r.me.quaternion.copy(camera.quaternion);}}

/* ---------- HTML labels projected from 3D ---------- */
const labelsEl=$('labels');
const rLabels=SIDE.map((c,i)=>{const d=document.createElement('div');d.className='rl';d.style.setProperty('--crew',c.css);d.innerHTML='<i></i><b></b><span>0%</span>';labelsEl.appendChild(d);
  on(d,'click',()=>pickSide(i));return{el:d,b:d.querySelector('b'),v:d.querySelector('span'),txt:'',w:0,x:0,y:0,on:false};});
const olabel=document.createElement('div');olabel.className='ol';olabel.textContent='ORBIT LINE · DAMM v2';labelsEl.appendChild(olabel);
const pops=[];for(let k=0;k<10;k++){const d=document.createElement('div');d.className='pop';labelsEl.appendChild(d);pops.push({el:d,t0:-9,live:false,s:0,dx:0});}
let popIdx=0;
function pop(s,txt,dn){const p=pops[popIdx++%pops.length];p.el.textContent=txt;p.el.className='pop'+(dn?' dn':'');p.el.style.setProperty('--crew',SIDE[s].css);Object.assign(p,{t0:clock,live:true,s,dx:SIDE[s].side*(26+Math.random()*30)});}

/* ---------- per-rocket emission + motion ---------- */
const tmpV=new V3(),downW=new V3(),acc=[{f:0,s:0,p:0,v:0,g:0},{f:0,s:0,p:0,v:0,g:0}];
const tier={particles:1,streak:1,glow:1};
const GOLD=col('#F5B544'),COOL=col('#CFE6FF');
function sparks(rk,n,speed){const p=nozzle(rk);for(let k=0;k<n;k++){const a=Math.random()*6.283,u=rnd(-.2,1);fireP.emit(p.x,p.y,p.z,Math.cos(a)*speed*rnd(.4,1),u*speed*.6-2,Math.sin(a)*speed*rnd(.4,1),rnd(.4,.8),.22,.1,.9,1,-9,1,0);}}
function nozzle(rk){rk.root.updateMatrixWorld();tmpV.set(0,-rk.L/2-.15,0);return rk.root.localToWorld(tmpV);}
function midPoint(rk){return rk.root.position.clone();}
let postFlash=0,searchBack=-1;
function startInsertion(rk,firstIn){
  const i=rk.i,c=rk.c,first=firstIn==null?!rockets[1-i].orbitVisual:firstIn;rk.orbitVisual=true;rk.orbitT=clock;rk.ins0.copy(rk.root.position);
  const cp=new V3(c.side*PAD_X,arcY(c.side*PAD_X),ORBIT_LINE_Z);
  arcU.uWaveT.value=0;arcU.uWaveU.value=uOfX(cp.x);arcU.uWaveA.value=first?1:.62;
  if(!RM){ring(cp,'#F5B544',first?3.4:2.4,1,first?30:18,first?1.6:1.3,false);ring(cp,'#FFFFFF',2,1,first?12:8,.9,false);crowdU.uFlare.value=first?1.3:.8;postFlash=first?1:.45;}
  rk.goldT=clock;sparks(rk,first?70:40,9);
  searches.forEach(sl=>{sl.mode='point';sl.tgt=cp;});searchBack=clock+3.2;
}
function updateRockets(dt){
  rockets.forEach((rk,i)=>{
    const sd=S.side[i],c=rk.c,q=tier.particles;
    if(!rk.root.visible){fireLight[i].intensity=0;(i?partU.uFl1:partU.uFl0).value.w=0;padGlow[i].deckPool.material.opacity=0;padGlow[i].groundPool.material.opacity=0;rk.fo.visible=rk.fc.visible=false;return;}
    const pre=mode==='demo'?TL.t<0:!sd.present;
    if(pre)rk.a=0;else rk.a+=(sd.alt-rk.a)*(1-Math.exp(-dt*(sd.orbit?6:2.2)));
    const tT=pre?0:(rk.orbitT<0?1:.22);
    rk.thrust+=(tT-rk.thrust)*(1-Math.exp(-dt*(tT>rk.thrust?3.4:1.1)));
    rk.burst*=Math.exp(-dt*2.3);rk.dip*=Math.exp(-dt*3);
    if(rk.pendingOrbit&&rk.a>.985){rk.pendingOrbit=false;startInsertion(rk,rk.firstIn);}
    if(rk.orbitT<0){
      const sway=Math.min(1,rk.a*5)*(1-EZ.sm(clamp((rk.a-.85)/.15,0,1)))*(RM?0:1);
      rk.root.position.set(c.side*PAD_X+Math.sin(clock*.9+i*2)*.16*sway,PAD_TOP+rk.L/2+rk.a*rk.climb,ORBIT_LINE_Z*rk.a+Math.cos(clock*.7+i)*.12*sway);
      rk.root.rotation.z=Math.sin(clock*1.3+i)*.012*sway;
    }else{
      const p=clamp((clock-rk.orbitT)/2.6,0,1),a0=Math.asin(c.side*PAD_X/ORBIT_LINE_R),aP=Math.asin(c.side*(PAD_X+(camera.aspect>1?7.5:2.5))/ORBIT_LINE_R);
      if(p>=1)rk.drift=Math.min(.05,rk.drift+dt*.0022);
      const ang=a0+(aP-a0)*EZ.io(clamp((p-.12)/.88,0,1))+c.side*rk.drift,rad=ORBIT_LINE_R+3.4*Math.sin(Math.PI*clamp(p*1.08,0,1));
      tmpV.set(ORBIT_LINE_C.x+Math.sin(ang)*rad,ORBIT_LINE_C.y+Math.cos(ang)*rad,ORBIT_LINE_C.z);
      rk.root.position.lerpVectors(rk.ins0,tmpV,EZ.out(Math.min(1,p*3.5)));
      const th=c.side<0?Math.atan2(Math.cos(ang),Math.sin(ang)):Math.atan2(-Math.cos(ang),-Math.sin(ang));
      rk.root.rotation.z=th*EZ.io(clamp((p-.08)/.75,0,1))+Math.sin(clock*1.1+i)*.01;
      rk.halo.material.opacity=EZ.out(clamp((p-.55)/.45,0,1))*.85;rk.halo.scale.setScalar(1+.04*Math.sin(clock*2+i));
    }
    const th=rk.thrust*(1+rk.burst*.55)*(1-rk.dip*.35),vis=th>.02;
    rk.fo.visible=rk.fc.visible=vis;
    const len=(2.6+5.6*rk.thrust)*(1+rk.burst*.5)*(1-rk.dip*.3)*(1+.04*Math.sin(clock*13+i)+.03*Math.sin(clock*17.3+i*2));
    const w=rk.bellR*(1+rk.burst*.22);rk.fo.scale.set(w,len,w);rk.fc.scale.set(rk.bellR*.55,len*.42,rk.bellR*.55);
    rk.fo.material.uniforms.uI.value=th;rk.fc.material.uniforms.uI.value=th*.55;rk.fo.material.uniforms.uTime.value=rk.fc.material.uniforms.uTime.value=clock;
    rk.nGlow.material.opacity=Math.min(1,th)*.62;rk.nGlow.scale.setScalar(4+6.5*Math.min(1.4,th));
    rk.streak.material.opacity=Math.min(1,th)*.5*tier.streak;rk.heat.material.opacity=Math.min(1,th)*.9;
    const nz=nozzle(rk);const lx=nz.x,ly=nz.y,lz=nz.z;
    fireLight[i].intensity=th*5.2*(1+.05*Math.sin(clock*9+i));fireLight[i].position.set(lx,ly-1.2,lz+.6);
    (i?partU.uFl1:partU.uFl0).value.set(lx,ly-1,lz,Math.min(1.3,th));
    const hA=rk.root.position.y-(PAD_TOP+rk.L/2),prox=rk.orbitT<0?1-EZ.sm(clamp(hA/14,0,1)):0;
    padGlow[i].deckPool.material.opacity=Math.min(1,th)*prox*.9;padGlow[i].groundPool.material.opacity=Math.min(1,th)*(.5*prox+.05);
    if(vis){
      downW.set(0,-1,0).applyQuaternion(rk.root.quaternion);const A=acc[i];
      A.f+=dt*(78*th+rk.burst*90)*q;
      while(A.f>=1){A.f--;const s=rnd(9,15);fireP.emit(lx+rnd(-.15,.15),ly+rnd(-.1,.1),lz+rnd(-.15,.15),downW.x*s+rnd(-1.4,1.4),downW.y*s+rnd(-1,1),downW.z*s+rnd(-1.4,1.4),rnd(.25,.5),rnd(.6,.9),rnd(1.8,2.9),.8,0,0,.9,rnd(-2,2));}
      A.s+=dt*34*th*q;
      while(A.s>=1){A.s--;const s=rnd(2.5,5);smokeP.emit(lx+downW.x*1.6+rnd(-.3,.3),ly+downW.y*1.6,lz+downW.z*1.6+rnd(-.3,.3),downW.x*s+rnd(-1,1),downW.y*s+rnd(-.6,.6),downW.z*s+rnd(-1,1),rnd(1.1,2.1),rnd(1,1.6),rnd(3.6,5.4),1,3,.35,.5,rnd(-.4,.4));}
      if(prox>.02){A.p+=dt*52*th*prox*q;while(A.p>=1){A.p--;const a=Math.random()*6.283,sp=rnd(5,13);smokeP.emit(c.side*PAD_X+Math.cos(a)*1.2,PAD_TOP+.3,Math.sin(a)*1.2,Math.cos(a)*sp,rnd(.3,1.6),Math.sin(a)*sp,rnd(4.5,7.5),rnd(1.6,2.4),rnd(7,11),.7,4,.25,.3,rnd(-.3,.3));}}
    }
    if(pre){const A=acc[i];A.v+=dt*7*q;while(A.v>=1){A.v--;smokeP.emit(c.side*PAD_X+c.side*c.rad*.9+rnd(-.15,.15),PAD_TOP+rk.L*rnd(.55,.85),rnd(-.2,.5),c.side*rnd(.3,1.1),rnd(-.4,0),rnd(.2,.8),rnd(2.4,3.6),rnd(.4,.6),rnd(2.4,3.4),.7,5,-.25,.26,rnd(-.3,.3));}}
    if(rk.goldT>0&&clock-rk.goldT<1.5){const A=acc[i];A.g+=dt*110*q;const p0=rk.root.position;
      while(A.g>=1){A.g--;const tx=c.side*rnd(22,34),tz=rnd(2,24),ty=rnd(.5,3),Tt=rnd(1.1,1.5),g=-5;
        fireP.emit(p0.x+rnd(-.3,.3),p0.y+rnd(-.3,.3),p0.z,(tx-p0.x)/Tt,(ty-p0.y-.5*g*Tt*Tt)/Tt,(tz-p0.z)/Tt,Tt,.42,.3,0,2,g,1,0);}}
    if(rk.goldT>0){const k=clock-rk.goldT;const gv=k<1.1?0:k<1.7?(k-1.1)/.6:Math.max(0,1-(k-1.7)/7);if(i)crowdU.uGold.value.y=gv;else crowdU.uGold.value.x=gv;}
    if(rk.extras){
      const sp=RM?60:4;
      rk.bst.forEach((b,k)=>{const tg=rk.a>=(k+1)*.25-.002?1:0;b.s+=(tg-b.s)*Math.min(1,dt*sp);b.g.visible=b.s>.01;b.g.scale.setScalar(Math.max(.001,EZ.out(clamp(b.s,0,1))));});
      const wt=rk.orbitVisual&&clock-rk.orbitT>1.2?1:0;rk.wingS+=(wt-rk.wingS)*Math.min(1,dt*(RM?60:2.5));rk.wings.forEach(wi=>{wi.visible=rk.wingS>.01;wi.scale.setScalar(Math.max(.001,rk.wingS));});
      rk.dayRings.forEach((d,k)=>{const tg=k<rk.alive?(rk.orbitVisual?.7:.42):0;d.material.opacity+=(tg-d.material.opacity)*Math.min(1,dt*(RM?60:3));d.visible=d.material.opacity>.01;});
    }
  });
}
function updateWorld(dt){
  lampU.uChase.value+=((mode==='demo'&&TL.phase==='count'?1:0)-lampU.uChase.value)*Math.min(1,dt*3);
  gantries.forEach((g,i)=>g.arms.forEach((pv,k)=>{const p=armsT[i]<0?0:clamp((clock-armsT[i]-k*.35)/1.7,0,1);pv.rotation.y=-SIDE[i].side*1.38*EZ.io(p);}));
  if(searchBack>0&&clock>searchBack){searchBack=-1;searches.forEach(sl=>sl.mode=racing()?'track':'sweep');}
  if(mode==='live'&&searchBack<0){const m=racing()?'track':'sweep';searches.forEach(sl=>{sl.mode=m;});}
  const pres=presentSides();
  searches.forEach((sl,k)=>{
    if(sl.mode==='sweep'){const t=RM?sl.ph:clock*sl.sp+sl.ph;sl.tdir.set(Math.sin(t)*.42+Math.sin(t*.37)*.12,1,.12+Math.cos(t*.8)*.18).normalize();}
    else if(sl.mode==='track'){const idx=pres.length>1||mode==='demo'?(k<2?0:k>2?1:(Math.floor(clock/6)%2)):(pres.length?pres[0]:0);const rk=rockets[idx];tmpV.copy(rk.root.position);tmpV.y+=3;sl.tdir.copy(tmpV).sub(sl.base).normalize();}
    else if(sl.tgt){sl.tdir.copy(sl.tgt).sub(sl.base).normalize();}
    sl.dir.lerp(sl.tdir,1-Math.exp(-dt*(sl.mode==='sweep'?.7:1.5))).normalize();aim(sl.cone,sl.dir);
    sl.cone.material.uniforms.uColor.value.lerp(sl.mode==='point'?GOLD:COOL,Math.min(1,dt*2.5));
  });
  floods.forEach(f=>{const lit=mode==='demo'||S.side[f.s].present?1:.3;f.lit+=(lit-f.lit)*Math.min(1,dt*2);f.cone.material.uniforms.uOpacity.value=.11*f.lit;f.sprite.material.opacity=.75*f.lit;});
  let maxA=0;pres.forEach(s=>{maxA=Math.max(maxA,S.side[s].alt);});
  arcU.uI.value=lerp(arcU.uI.value,.3+.6*EZ.sm(clamp((maxA-.72)/.26,0,1))*(allOrbit()?.4:1),Math.min(1,dt*2));
  if(arcU.uWaveT.value>=0){arcU.uWaveT.value+=dt;arcU.uCharge.value=lerp(arcU.uCharge.value,.22,Math.min(1,dt*1.5));if(arcU.uWaveT.value>8)arcU.uWaveT.value=-1;}
  crowdU.uFlare.value*=Math.exp(-dt*.9);postFlash*=Math.exp(-dt*2.6);
  updateRings();
}

/* ---------- FX hooks: every event -> one visible effect ---------- */
FX.buy=(s,amt,e)=>{
  const a=amt==null?120:amt;
  crowdPulse(s,clamp(.3+a/480,.3,1.7));
  if(e&&e.type==='commit')return;
  const rk=rockets[s];if(!rk.root.visible)return;
  rk.burst=Math.min(1.6,rk.burst+a/520);
  if(amt!=null&&(amt>=140||(e&&(e.tag||e.fin)))){const p=midPoint(rk);p.y-=rk.L*.15;ring(p,SIDE[s].color,2.4,1.1,3+amt/230,.85+Math.min(.5,amt/1600),true);}
  if(amt!=null&&amt>=150&&(!isPhone()||amt>=300))pop(s,'+'+fmtUsdAuto(amt));
  if(mode==='live'||TL.t>=0)sparks(rk,Math.min(26,4+Math.round(a/45)),6+a/150);
};
FX.sell=(s,amt)=>{const rk=rockets[s];if(!rk.root.visible)return;rk.dip=Math.min(1,rk.dip+.6);if(amt!=null)pop(s,'−'+fmtUsdAuto(amt),true);};
FX.window=(s,e)=>{crowdPulse(s,1.8);const rk=rockets[s];rk.burst=1.4;const p=midPoint(rk);ring(p,SIDE[s].color,2.6,1.4,9,1.35,true);pop(s,'+'+fmtUsd(e.amount)+' window');};
FX.ignite=(sides)=>{
  if(!RM)crowdU.uFlare.value=1.1;
  (sides||[0,1]).forEach(i=>{const rk=rockets[i];if(!rk.root.visible)return;const x=rk.c.side*PAD_X;for(let k=0;k<90*tier.particles;k++){const a=Math.random()*6.283,sp=rnd(4,14);smokeP.emit(x+Math.cos(a)*1.4,PAD_TOP+.4,Math.sin(a)*1.4,Math.cos(a)*sp,rnd(.4,2.2),Math.sin(a)*sp,rnd(4.5,8),rnd(1.8,2.8),rnd(7,12),.75,4,.22,.34,rnd(-.3,.3));}
    sparks(rk,60,8);ring(new V3(x,PAD_TOP+.2,0),'#FF9A3C',2.6,2,13,1.2,true);});
  searches.forEach(sl=>sl.mode='track');
};
FX.booster=(s,n)=>{const rk=rockets[s];if(!rk.root.visible)return;crowdPulse(s,1+n*.2);rk.burst=Math.min(1.6,rk.burst+.9);const p=midPoint(rk);ring(p,'#F5B544',2.6,1.2,6+n*2,1.1,true);sparks(rk,30+n*8,8);};
FX.check=(s)=>{const rk=rockets[s];if(!rk.root.visible)return;crowdPulse(s,1);const p=midPoint(rk);ring(p,'#FFFFFF',1.8,1.4,7,1.1,true);};
FX.lost=(s)=>{const rk=rockets[s];if(!rk.root.visible)return;rk.dip=1;};
FX.arms=()=>{armsT[0]=armsT[1]=clock;};
FX.countdown=()=>{};
FX.orbit=(s,first)=>{rockets[s].pendingOrbit=true;rockets[s].firstIn=first==null?null:!!first;};
FX.orbitSky=()=>{
  const cp=new V3(0,Y_ORBIT,ORBIT_LINE_Z);arcU.uWaveT.value=0;arcU.uWaveU.value=.5;arcU.uWaveA.value=1;
  if(!RM){ring(cp,'#F5B544',3.4,1,30,1.6,false);ring(cp,'#FFFFFF',2,1,12,.9,false);crowdU.uFlare.value=1.3;postFlash=1;}
  searches.forEach(sl=>{sl.mode='point';sl.tgt=cp;});searchBack=clock+3.2;
};
FX.userCall=(s)=>{crowdPulse(s,1.4);ring(new V3(SIDE[s].side*PAD_X,.3,0),SIDE[s].color,2.2,4,16,1.2,true);};
FX.post=()=>{searches.forEach(sl=>sl.mode='sweep');};
FX.reset=()=>{
  rockets.forEach(resetRocket);
  armsT[0]=armsT[1]=-1;arcU.uWaveT.value=-1;arcU.uCharge.value=0;crowdU.uFlare.value=0;crowdU.uGold.value.set(0,0);postFlash=0;searchBack=-1;
  smokeP.kill();fireP.kill();rings.forEach(r=>{r.live=false;r.me.visible=false;});pops.forEach(p=>{p.live=false;p.el.style.opacity='0';});
  searches.forEach(sl=>{sl.mode='sweep';sl.cone.material.uniforms.uColor.value.copy(COOL);});
  camNext=0;camIdx=-1;camHoldUntil=0;
  Cam.cut('idle',0);
};
FX.setRocket=(s,spec,alive)=>{
  if(!spec){rockets[s].root.visible=false;armsT[s]=-1;return;}
  const key=[spec.id||spec.key,spec.seed,spec.len.toFixed(3),spec.rad.toFixed(3),spec.fins,spec.accent,spec.base,spec.nose,spec.extras?1:0].join('|');
  if(rockets[s].key!==key){freeRocket(rockets[s]);rockets[s]=buildRocket(s,spec);rockets[s].key=key;}
  const rk=rockets[s];resetRocket(rk);rk.root.visible=true;rk.alive=alive||0;
  if(mode==='live'){
    rk.a=S.side[s].alt;rk.thrust=1;armsT[s]=clock-10;
    rk.bst.forEach((b,k)=>{b.s=rk.a>=(k+1)*.25-.002?1:0;});
    rk.dayRings.forEach((d,k)=>{d.material.opacity=k<rk.alive?.42:0;});
  }else armsT[s]=-1;
};
FX.alive=(s,n)=>{rockets[s].alive=n||0;};
FX.label=(s,tk)=>{const L=rLabels[s];L.b.textContent=tk||'';L.w=0;L.el.classList.toggle('pick',mode==='live'&&!!tk);};
FX.select=(sel)=>{rLabels.forEach((L,i)=>L.el.classList.toggle('sel',sel===i));camNext=clock;};
FX.mode=()=>{olabel.textContent=mode==='demo'?'ORBIT LINE · 15,454 USDC':'ORBIT LINE · DAMM v2';olabel.dataset.w='';rLabels.forEach(L=>{L.el.classList.toggle('pick',mode==='live'&&!!L.b.textContent);L.txt='';});};
[[-150,-260],[90,-300],[210,-180],[-240,-150],[300,40],[-320,60]].forEach(([x,z],k)=>lamp(x,9+k%3*3,z,'#EF4444',3.2,3,k*.17,.9));
buildLamps();

/* ---------- camera director: broadcast cuts as 1.7 s eases, never shake ---------- */
const safe={h:.58,off:.12,th:.58,toff:.12,top:200,bot:700};
function measureSafe(){
  const rr=root.getBoundingClientRect(),Hh=rr.height||vh(),vs=H.vs.getBoundingClientRect(),l3=app.querySelector('.lower3').getBoundingClientRect();
  let top=vs.bottom-rr.top+6,bot=l3.top-rr.top-6;
  if(isPhone()){
    const ce=mode==='demo'?(!cta.classList.contains('hide')&&!root.classList.contains('post-a')?cta:null):(root.classList.contains('is-empty')?emptyCard:null);
    if(ce)bot=Math.min(bot,ce.getBoundingClientRect().top-rr.top-6);
  }
  top=clamp(top,0,Hh*.6);bot=clamp(bot,top+Hh*.22,Hh);
  safe.top=top;safe.bot=bot;safe.th=(bot-top)/Hh;safe.toff=((top+bot)/2-Hh/2)/(Hh/2);
}
const cdir=new V3();
function fr(cx,cy,cz,hw,hh,dx,dy,dz,fov,o){
  const tf=Math.tan(fov*Math.PI/360);cdir.set(dx,dy,dz).normalize();
  const d=Math.max(hh/(tf*safe.h),hw/(tf*camera.aspect)),sh=safe.off*d*tf;
  o.p.set(cx+cdir.x*d,cy+cdir.y*d+sh,cz+cdir.z*d);o.t.set(cx,cy+sh,cz);o.f=fov;return o;
}
function bounds(){let lo=1e9,hi=-1e9;rockets.forEach(rk=>{if(!rk.root.visible)return;const y=rk.root.position.y;lo=Math.min(lo,y-rk.L/2-5.5);hi=Math.max(hi,y+rk.L/2+2.5);});if(hi<lo)return{lo:-1,hi:14};return{lo:Math.max(-1,lo),hi};}
function padShot(i,o){const s=SIDE[i].side,since=Math.max(0,clock-Cam.t0);return fr(s*PAD_X+s*1.4,7,0,6.5,7.6-Math.min(1.6,since*.28),s*.62,-.2,1,40,o);}
function closeShot(i,o){const p=rockets[i].root.position,s=SIDE[i].side;return fr(p.x,p.y-1.6,p.z,5.5,7.8,s*.55,-.32,1,42,o);}
const SHOTS={
  idle:(o)=>{const k=RM?0:Math.sin(clock*.045);return camera.aspect>1?fr(0,15.8,0,16,16.6,.14*k,-.16,1,46,o):fr(0,9.6,0,13.2,9.4,.12*k,-.14,1,48,o);},
  padL:(o)=>padShot(0,o),padR:(o)=>padShot(1,o),
  wideLow:(o)=>fr(0,6.4,0,15.5,7.2,0,-.06,1,42,o),
  wide:(o)=>{const b=bounds();return fr(0,(b.lo+b.hi)/2,0,13.5,Math.max(8.5,(b.hi-b.lo)/2),RM?0:Math.sin(clock*.07)*.08,-.08,1,46,o);},
  closeL:(o)=>closeShot(0,o),closeR:(o)=>closeShot(1,o),
  wideArc:(o)=>{const b=bounds(),hi=Y_ORBIT+3.5,lo=Math.min(b.lo,hi-26);return fr(0,(lo+hi)/2,0,15,(hi-lo)/2,0,-.1,1,46,o);},
  final:(o)=>{const k=RM?0:Math.sin(clock*.04);return fr(0,21,0,camera.aspect>1?21:15.5,19.5,.1*k,-.08,1,46,o);},
  all:(o)=>fr(0,20,0,camera.aspect>1?20:15.5,22,0,-.06,1,46,o)
};
const poseA={p:new V3(),t:new V3(),f:46},poseB={p:new V3(),t:new V3(),f:46},cur={p:new V3(),t:new V3(),f:46};
const Cam={shot:RM?'all':'idle',prev:null,t0:0,dur:0,
  cut(name,dur){if(RM){name='all';dur=0;}if(name===this.shot&&dur!==0)return;this.prev=dur===0?null:this.shot;this.shot=name;this.t0=clock;this.dur=dur==null?1.7:dur;},
  update(){
    SHOTS[this.shot](poseB);const k=this.dur>0?clamp((clock-this.t0)/this.dur,0,1):1;
    if(this.prev&&k<1){SHOTS[this.prev](poseA);const e=EZ.io(k);cur.p.lerpVectors(poseA.p,poseB.p,e);cur.t.lerpVectors(poseA.t,poseB.t,e);cur.f=lerp(poseA.f,poseB.f,e);}
    else{cur.p.copy(poseB.p);cur.t.copy(poseB.t);cur.f=poseB.f;}
    camera.position.copy(cur.p);camera.lookAt(cur.t);if(Math.abs(camera.fov-cur.f)>.01){camera.fov=cur.f;camera.updateProjectionMatrix();}
  }};
FX.cut=(n)=>Cam.cut(n);
/* LIVE: the broadcast cuts between the pads in flight; a selection holds its close shot; an orbit holds the arc */
let camNext=0,camIdx=-1,camHoldUntil=0;
FX.liveCam=()=>{
  const pres=presentSides();
  if(!pres.length){Cam.cut('idle');return;}
  if(selectedSide!==null&&S.side[selectedSide].present){Cam.cut(selectedSide?'closeR':'closeL');camNext=clock+3;return;}
  if(clock<camHoldUntil)return;
  if(clock>=camNext){const list=pres.length>1?['wide','closeL','wideArc','closeR']:['wide',pres[0]?'closeR':'closeL','wideArc'];camIdx=(camIdx+1)%list.length;Cam.cut(list[camIdx]);camNext=clock+8.5;}
};
FX.holdCam=(n,sec)=>{Cam.cut(n);camHoldUntil=clock+sec;camNext=clock+sec;};

/* ---------- post: HDR bloom, ACES, grain (high/medium); direct ACES + glow sprites (low) ---------- */
const halfOK=R.capabilities.isWebGL2&&(R.extensions.has('EXT_color_buffer_float')||R.extensions.has('EXT_color_buffer_half_float'));
let composer=null,bloom=null,finalPass=null,useComposer=false;
function setupComposer(){
  if(composer)return;
  const rt=new T.WebGLRenderTarget(4,4,{type:T.HalfFloatType,format:T.RGBAFormat,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
  composer=new EffectComposer(R,rt);composer.addPass(new RenderPass(scene,camera));
  bloom=new UnrealBloomPass(new T.Vector2(vw(),vh()),.85,.55,.78);composer.addPass(bloom);
  finalPass=new ShaderPass({uniforms:{tDiffuse:{value:null},uTime:{value:0},uFlash:{value:0},uRes:{value:new T.Vector2(1,1)}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime,uFlash;uniform vec2 uRes;varying vec2 vUv;
    vec3 aces(vec3 x){x*=1./.6;const mat3 I=mat3(vec3(.59719,.07600,.02840),vec3(.35458,.90834,.13383),vec3(.04823,.01566,.83777));
      const mat3 O=mat3(vec3(1.60475,-.10208,-.00327),vec3(-.53108,1.10813,-.07276),vec3(-.07367,-.00605,1.07602));
      x=I*x;vec3 a=x*(x+.0245786)-.000090537;vec3 b=x*(.983729*x+.4329510)+.238081;return clamp(O*(a/b),0.,1.);}
    vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
    float hs(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){vec2 dc=vUv-.5;float ca=.0011+uFlash*.0035;vec3 c;
      c.r=texture2D(tDiffuse,vUv+dc*ca).r;c.g=texture2D(tDiffuse,vUv).g;c.b=texture2D(tDiffuse,vUv-dc*ca).b;
      c+=vec3(1.,.93,.82)*uFlash*.2;c=srgb(aces(c));c+=(hs(vUv*uRes+fract(uTime*7.)*91.)-.5)*.016;gl_FragColor=vec4(c,1.);}`});
  composer.addPass(finalPass);
}
const TIERS={high:{pr:1.75,bloom:1,particles:1,crowd:7200,stars:3400,streak:1},medium:{pr:1.35,bloom:.5,particles:.65,crowd:4600,stars:2400,streak:1},low:{pr:1,bloom:0,particles:.4,crowd:2600,stars:1500,streak:0}};
let tierName=(isPhone()||COARSE)?'medium':'high',lastFps=0;
function applyTier(n){
  tierName=n;const t=TIERS[n];R.setPixelRatio(Math.min(window.devicePixelRatio||1,t.pr,MAX_PR));
  useComposer=t.bloom>0&&halfOK;
  if(useComposer){setupComposer();R.toneMapping=T.NoToneMapping;R.outputEncoding=T.LinearEncoding;}
  else{R.toneMapping=T.ACESFilmicToneMapping;R.toneMappingExposure=1;R.outputEncoding=T.sRGBEncoding;}
  scene.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true);});
  crowdGeo.setDrawRange(0,t.crowd);starGeo.setDrawRange(0,t.stars);
  tier.particles=t.particles;tier.streak=t.streak;tier.glow=useComposer?1:1.45;
  smokeP.cap=Math.max(500,Math.round(smokeP.max*t.particles));fireP.cap=Math.max(500,Math.round(fireP.max*t.particles));
  if(smokeP.cur>=smokeP.cap)smokeP.cur=0;if(fireP.cur>=fireP.cap)fireP.cur=0;
  root.dataset.tier=n;resize();
  cb('onQuality',n,Math.round(lastFps));
}
function resize(){
  const w=vw(),h=vh();camera.aspect=w/h;camera.updateProjectionMatrix();R.setSize(w,h);
  const pr=R.getPixelRatio();starU.uPR.value=pr;
  if(composer){composer.setPixelRatio(pr);composer.setSize(w,h);if(TIERS[tierName].bloom<1)bloom.setSize(Math.round(w*pr/2),Math.round(h*pr/2));finalPass.uniforms.uRes.value.set(w*pr,h*pr);}
  measureSafe();
}
let ro=null;
if(typeof ResizeObserver==='function'){ro=new ResizeObserver(()=>{if(!disposed)resize();});ro.observe(root);}else on(window,'resize',resize);
const probe={t:0,n:0,phase:'warm',drops:0,done:false,win:0,wn:0};
function probeTick(raw){
  const thr=(isPhone()||COARSE)?MIN_FPS:Math.max(MIN_FPS,45);
  if(!probe.done){probe.t+=raw;
    if(probe.phase==='warm'){if(probe.t>1.2){probe.phase='measure';probe.t=0;probe.n=0;}return;}
    probe.n++;if(probe.t>=2){const fps=probe.n/probe.t;lastFps=fps;
      if(fps<thr&&tierName!=='low'){applyTier(tierName==='high'?'medium':'low');probe.drops++;probe.phase='warm';probe.t=0;if(probe.drops>=2)probe.done=true;}else{probe.done=true;cb('onQuality',tierName,Math.round(fps));}}
    return;}
  probe.win+=raw;probe.wn++;if(probe.win>=5){const fps=probe.wn/probe.win;lastFps=fps;probe.win=0;probe.wn=0;if(fps<thr*.8&&tierName!=='low'&&probe.drops<2){probe.drops++;applyTier(tierName==='high'?'medium':'low');}}
}

/* ---------- projected labels ---------- */
const pv=new V3();
function scr(v){pv.copy(v).project(camera);return pv;}
function placeEl(el,x,y,op){el.style.transform=`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)`;el.style.opacity=op;}
function labelText(i){
  const sd=S.side[i];if(sd.orbit)return 'ORBIT';
  if(mode==='live'){const m=pads[i]?roster.get(pads[i]):null;if(!m||!isNum(m.altitude))return '—';}
  return Math.floor(sd.disp*100)+'%';
}
function updateLabels(){
  const W=vw(),Hh=vh();
  rockets.forEach((rk,i)=>{
    const L=rLabels[i];
    if(!rk.root.visible){if(L.on||L.el.style.opacity!=='0'){L.on=false;L.el.style.opacity='0';L.el.style.pointerEvents='none';}return;}
    tmpV.copy(rk.root.position);tmpV.y+=rk.orbitT<0?rk.L/2+1.1:1.9;
    const p=scr(tmpV),x=(p.x*.5+.5)*W,y=(-p.y*.5+.5)*Hh,ok=p.z<1&&y>safe.top+30&&y<safe.bot-6&&x>40&&x<W-40;
    const t=labelText(i);if(t!==L.txt){L.txt=t;L.v.textContent=t;L.w=0;}
    if(!L.w)L.w=L.el.offsetWidth||110;const cx=clamp(x,L.w/2+6,W-L.w/2-6);L.x=cx;L.y=y;L.on=ok;
    placeEl(L.el,cx,y,ok?1:0);L.el.style.pointerEvents=ok?'':'none';
  });
  tmpV.set(0,Y_ORBIT+1.2,ORBIT_LINE_Z);const p=scr(tmpV),ox=(p.x*.5+.5)*W,oy=(-p.y*.5+.5)*Hh,ow=olabel.offsetWidth||170;
  const hit=rLabels.some(L=>L.on&&Math.abs(L.x-ox)<(L.w+ow)/2+8&&Math.abs(L.y-oy)<30);
  placeEl(olabel,clamp(ox,ow/2+6,W-ow/2-6),oy,p.z<1&&!hit&&oy>safe.top+16&&oy<safe.bot-10&&!(mode==='demo'&&TL.phase==='post')?.9:0);
  for(const q of pops){if(!q.live)continue;const k=(clock-q.t0)/1.25;if(k>=1){q.live=false;q.el.style.opacity='0';continue;}
    const rk=rockets[q.s];tmpV.copy(rk.root.position);const s=scr(tmpV);const x=clamp((s.x*.5+.5)*W+q.dx*(.6+.4*k),44,W-44),y=(-s.y*.5+.5)*Hh-50*EZ.out(k);
    const vis=s.z<1&&y>safe.top+20&&y<safe.bot;placeEl(q.el,x,y,vis?(k<.12?k/.12:1-Math.pow((k-.12)/.88,2)):0);}
}

/* ---------- one frame ---------- */
let safeAcc=0;
function frame(dt,raw){
  partU.uTime.value=clock;
  step(dt);
  skyU.uTime.value=starU.uTime.value=lampU.uTime.value=crowdU.uTime.value=arcU.uTime.value=clock;skyU.uFlash.value=postFlash;
  updateRockets(dt);updateWorld(dt);
  safeAcc+=dt;if(safeAcc>.5){safeAcc=0;measureSafe();}
  safe.h+=(safe.th-safe.h)*Math.min(1,dt*2.2);safe.off+=(safe.toff-safe.off)*Math.min(1,dt*2.2);
  Cam.update();skyGroup.position.copy(camera.position);
  const ps=R.domElement.height/(2*Math.tan(camera.fov*Math.PI/360));lampU.uScale.value=crowdU.uScale.value=ps;
  rockets.forEach(rk=>{rk.nGlow.material.opacity=Math.min(1,rk.nGlow.material.opacity*(tier.glow||1));});
  updateLabels();smokeP.flush();fireP.flush();
  if(useComposer){finalPass.uniforms.uTime.value=clock;finalPass.uniforms.uFlash.value=RM?0:postFlash;composer.render();}else R.render(scene,camera);
  probeTick(raw);
}
function dispose3D(){
  if(ro){ro.disconnect();ro=null;}
  const geos=new Set(),mats=new Set(),texs=new Set(texList);
  rockets.forEach(rk=>rk.own.forEach(x=>{if(x&&x.isTexture)texs.add(x);else if(x&&x.isMaterial)mats.add(x);else if(x&&x.isBufferGeometry)geos.add(x);}));
  scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m));});
  mats.forEach(m=>{for(const k in m){const v=m[k];if(v&&v.isTexture)texs.add(v);}if(m.uniforms)for(const k in m.uniforms){const v=m.uniforms[k]&&m.uniforms[k].value;if(v&&v.isTexture)texs.add(v);}});
  [geos,mats,texs].forEach(set=>set.forEach(x=>{try{x.dispose();}catch(_e){/* lost context */}}));
  if(composer){try{composer.dispose();bloom.dispose();finalPass.dispose();}catch(_e){/* lost context */}}
  try{R.dispose();}catch(_e){/* lost context */}
  if(R.domElement.parentNode)R.domElement.parentNode.removeChild(R.domElement);
  rLabels.forEach(L=>L.el.remove());olabel.remove();pops.forEach(p=>p.el.remove());
}
try{const qs=new URLSearchParams(window.location.search).get('quality');if(qs&&TIERS[qs]){tierName=qs;probe.done=true;probe.drops=2;}}catch(_e){/* no query */}
applyTier(tierName);measureSafe();safe.h=safe.th;safe.off=safe.toff;Cam.update();
return {frame,dispose:dispose3D};
}

/* ======================= boot ======================= */
let api3d=null,rafId=0,last=performance.now();
function fallTo2D(){
  if(api3d){const a=api3d;api3d=null;try{a.dispose();}catch(_e){/* lost context */}}
  Object.assign(FX,NOOP_FX());
  root.classList.add('is-no3d');
  cb('onRenderer','2d');
}
if(webglOK()){
  try{api3d=init3D(()=>{if(!disposed&&api3d)fallTo2D();});}
  catch(_err){api3d=null;$('stage').innerHTML='';Object.assign(FX,NOOP_FX());}
}
if(api3d)cb('onRenderer','webgl');else{root.classList.add('is-no3d');cb('onRenderer','2d');}
function loop(now){
  if(disposed)return;
  rafId=requestAnimationFrame(loop);
  const raw=Math.min(.25,Math.max(0,(now-last)/1000));last=now;const dt=Math.min(.05,raw);
  clock+=dt;
  if(api3d){try{api3d.frame(dt,raw);}catch(_err){fallTo2D();}}
  else{try{step(dt);}catch(_err){/* the board keeps its last frame */}}
}
setPhase('live');
paintModeText();renderLiveSide(0);renderLiveSide(1);updateEmpty();
cb('onSource','live');
later(()=>root.classList.remove('is-boot'),120);
rafId=requestAnimationFrame(loop);

return {
  setSnapshot(snap){
    if(disposed||!snap||typeof snap!=='object'||snap.source==='demo')return;
    liveSnap=snap;
    if(mode==='live')ingest(snap);
  },
  emit(event){if(disposed||mode!=='live'||!hasSnap)return;liveEmit(event);},
  select(id){if(disposed)return;applySelect(id==null?null:String(id));},
  playDemo(){playDemo();},
  stopDemo(){stopDemo();},
  setSound(on_){if(disposed)return;setSoundInternal(!!on_);},
  dispose(){
    if(disposed)return;disposed=true;
    cancelAnimationFrame(rafId);
    timers.forEach(id=>clearTimeout(id));timers.clear();
    listeners.forEach(([t,type,fn,o])=>t.removeEventListener(type,fn,o));listeners.length=0;
    if(api3d){try{api3d.dispose();}catch(_e){/* lost context */}api3d=null;}
    Sound.close();
    if(app.parentNode)app.parentNode.removeChild(app);
    root.classList.remove('mc-launch-night','is-boot','is-demo','is-no3d','is-reduced','post-a','post-b','is-empty','is-reading');
    delete root.dataset.phase;delete root.dataset.tier;
  }
};
}
