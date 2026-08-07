const STORAGE_KEY='curatoros-content-opportunity-briefing-v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=value=>{const n=Number(value||0);return`${n>0?'+':''}${n}`};

function readSaved(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch{return null}}
function writeSaved(value){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(value))}catch{}}

function install(){
  if(document.querySelector('#changeBriefing'))return;
  const anchor=document.querySelector('.launch');
  if(!anchor)return;
  const section=document.createElement('section');
  section.id='changeBriefing';
  section.className='panel';
  section.style.cssText='margin:18px 0;padding:18px';
  section.innerHTML=`
    <div style="display:flex;gap:16px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
      <div><p class="eyebrow">Since Last Time</p><h2 style="margin:.2rem 0 .4rem">What changed?</h2><p style="margin:0;color:var(--muted,#b7b6ad);max-width:780px">A compact editorial briefing of newly surfaced opportunities, meaningful ranking movement, lifecycle changes, matured verification, and feedback-learning adjustments.</p></div>
      <button id="refreshBriefing" class="secondary">Refresh briefing</button>
    </div>
    <div id="briefingMeta" style="margin-top:10px;color:var(--muted,#b7b6ad);font-size:.78rem"></div>
    <div id="briefingSummary" class="summary-grid" style="margin-top:14px"></div>
    <div id="briefingBody" style="display:grid;gap:10px;margin-top:14px"></div>`;
  anchor.insertAdjacentElement('afterend',section);
  section.querySelector('#refreshBriefing')?.addEventListener('click',refreshBriefing);
  const saved=readSaved();
  if(saved?.lastComparison)renderComparison(saved.lastComparison,saved.capturedAt,true);
  else renderEmpty('No briefing baseline yet. Choose Refresh briefing to establish one.');
}

async function refreshBriefing(){
  const button=document.querySelector('#refreshBriefing');
  const meta=document.querySelector('#briefingMeta');
  if(button){button.disabled=true;button.textContent='Refreshing…';}
  if(meta)meta.textContent='Reading discovery, verification, lifecycle, and curator feedback…';
  try{
    const [discoveryResponse,verificationResponse,feedbackResponse]=await Promise.all([
      fetch('/api/discover',{cache:'no-store'}),
      fetch('/api/verification',{cache:'no-store'}),
      fetch('/api/feedback',{cache:'no-store'})
    ]);
    const discovery=await discoveryResponse.json().catch(()=>({}));
    const verification=await verificationResponse.json().catch(()=>({}));
    const feedback=await feedbackResponse.json().catch(()=>({}));
    if(!discoveryResponse.ok||discovery?.ok===false)throw new Error(discovery?.detail||discovery?.error||`Discovery returned ${discoveryResponse.status}`);
    if(!verificationResponse.ok||verification?.ok===false)throw new Error(verification?.detail||verification?.error||`Verification returned ${verificationResponse.status}`);
    if(!feedbackResponse.ok||feedback?.ok===false)throw new Error(feedback?.error||`Feedback returned ${feedbackResponse.status}`);
    const previous=readSaved()?.snapshot||null;
    const current=makeSnapshot(discovery,verification,feedback);
    const comparison=compare(previous,current,discovery.reconciliation||{});
    const capturedAt=new Date().toISOString();
    writeSaved({capturedAt,snapshot:current,lastComparison:comparison});
    renderComparison(comparison,capturedAt,false);
  }catch(error){
    renderEmpty(`Briefing could not refresh: ${error.message}`);
  }finally{
    if(button){button.disabled=false;button.textContent='Refresh briefing';}
  }
}

function makeSnapshot(discovery,verification,feedback){
  return{
    opportunities:(discovery.opportunities||[]).map(x=>({
      id:String(x.id),title:x.title,type:x.type,decisionScore:Number(x.decisionScore??x.score??0),rank:Number(x.workNextRank||0),feedbackAdjustment:Number(x.feedbackAdjustment||0),signals:x.prioritization?.signalLanes||[]
    })),
    verification:(verification.records||[]).filter(x=>x.status==='implemented').map(x=>({
      id:String(x.id),page:x.page||x.query||'',state:x.verification?.state||'insufficient',label:x.verification?.label||x.verification?.state||'insufficient',checkpoint:x.verification?.checkpoint||null,ready:Boolean(x.verification?.ready),ageDays:Number(x.verification?.ageDays||0)
    })),
    feedback:activeFeedback(feedback.profile||{}),
    workNext:discovery.summary?.workNext||null,
    discoveryGeneratedAt:discovery.generatedAt||null
  };
}

function activeFeedback(profile){
  const out=[];
  for(const [name,x] of Object.entries(profile.byType||{}))if(Number(x.adjustment||0))out.push({key:`type:${name}`,kind:'type',name,adjustment:Number(x.adjustment),decisions:Number(x.decisions||0)});
  for(const [name,x] of Object.entries(profile.byLane||{}))if(Number(x.adjustment||0))out.push({key:`lane:${name}`,kind:'lane',name,adjustment:Number(x.adjustment),decisions:Number(x.decisions||0)});
  return out;
}

function compare(previous,current,reconciliation){
  if(!previous)return{baselineAvailable:false,summary:{newOpportunities:0,rankMovers:0,verificationChanges:0,feedbackChanges:0,resolved:Number(reconciliation.resolved||0),reopened:Number(reconciliation.autoReopened||0)},workNext:current.workNext,newOpportunities:[],rankMovers:[],verificationChanges:[],feedbackChanges:[],lifecycle:reconciliation};
  const oldOpp=new Map((previous.opportunities||[]).map(x=>[x.id,x]));
  const newOpportunities=[];
  const rankMovers=[];
  for(const item of current.opportunities||[]){
    const before=oldOpp.get(item.id);
    if(!before){newOpportunities.push(item);continue;}
    if(before.rank&&item.rank&&before.rank!==item.rank){rankMovers.push({...item,from:before.rank,to:item.rank,change:before.rank-item.rank,scoreChange:item.decisionScore-before.decisionScore});}
  }
  newOpportunities.sort((a,b)=>a.rank-b.rank);
  rankMovers.sort((a,b)=>Math.abs(b.change)-Math.abs(a.change)||a.to-b.to);

  const oldVerification=new Map((previous.verification||[]).map(x=>[x.id,x]));
  const verificationChanges=[];
  for(const item of current.verification||[]){const before=oldVerification.get(item.id);if(!before){if(item.ready)verificationChanges.push({...item,previousState:null});continue;}if(before.state!==item.state||before.checkpoint!==item.checkpoint||before.ready!==item.ready)verificationChanges.push({...item,previousState:before.state,previousCheckpoint:before.checkpoint});}

  const oldFeedback=new Map((previous.feedback||[]).map(x=>[x.key,x]));
  const feedbackChanges=[];
  for(const item of current.feedback||[]){const before=oldFeedback.get(item.key);if(!before||before.adjustment!==item.adjustment)feedbackChanges.push({...item,previousAdjustment:before?.adjustment||0});oldFeedback.delete(item.key);}
  for(const item of oldFeedback.values())feedbackChanges.push({...item,previousAdjustment:item.adjustment,adjustment:0});

  return{
    baselineAvailable:true,
    summary:{
      newOpportunities:newOpportunities.length,
      rankMovers:rankMovers.length,
      verificationChanges:verificationChanges.length,
      feedbackChanges:feedbackChanges.length,
      resolved:Number(reconciliation.resolved||0),
      reopened:Number(reconciliation.autoReopened||0)
    },
    workNext:current.workNext,
    newOpportunities:newOpportunities.slice(0,8),
    rankMovers:rankMovers.slice(0,8),
    verificationChanges:verificationChanges.slice(0,8),
    feedbackChanges:feedbackChanges.slice(0,8),
    lifecycle:reconciliation
  };
}

function renderComparison(c,capturedAt,stored){
  const meta=document.querySelector('#briefingMeta'),summary=document.querySelector('#briefingSummary'),body=document.querySelector('#briefingBody');
  if(!meta||!summary||!body)return;
  meta.textContent=`${c.baselineAvailable?'Changes compared with the previous briefing':'Baseline established'} · ${stored?'last saved ':'updated '}${new Date(capturedAt).toLocaleString()}`;
  const s=c.summary||{};
  const cards=[['New',s.newOpportunities||0],['Rank moves',s.rankMovers||0],['Verification',s.verificationChanges||0],['Feedback',s.feedbackChanges||0],['Resolved',s.resolved||0],['Reopened',s.reopened||0]];
  summary.innerHTML=cards.map(([l,v])=>`<article class="summary-card panel"><strong>${esc(v)}</strong><span>${esc(l)}</span></article>`).join('');
  if(!c.baselineAvailable){
    body.innerHTML=`<div class="empty"><strong>Briefing baseline established.</strong><br>Future refreshes will compare against this snapshot.${c.workNext?` Current Work Next: ${esc(c.workNext.title)} · decision score ${esc(c.workNext.decisionScore)}`:''}</div>`;
    return;
  }
  const sections=[];
  if(c.workNext)sections.push(`<article class="panel" style="padding:14px"><p class="eyebrow">Work Next</p><h3 style="margin:.25rem 0">${esc(c.workNext.title)}</h3><p style="margin:0;color:var(--muted,#b7b6ad)">${esc(c.workNext.type)} · decision score ${esc(c.workNext.decisionScore)}</p></article>`);
  if(c.newOpportunities?.length)sections.push(group('Newly surfaced',c.newOpportunities.map(x=>`${x.rank?`#${x.rank} · `:''}${x.title} · ${x.type}`)));
  if(c.rankMovers?.length)sections.push(group('Ranking movement',c.rankMovers.map(x=>`${x.title} · #${x.from} → #${x.to} (${signed(x.change)} places)${x.scoreChange?` · score ${signed(x.scoreChange)}`:''}`)));
  if(c.verificationChanges?.length)sections.push(group('Verification matured',c.verificationChanges.map(x=>`${x.page} · ${x.previousState?`${x.previousState} → `:''}${x.label}${x.checkpoint?` · ${x.checkpoint}`:''}`)));
  if(c.feedbackChanges?.length)sections.push(group('Feedback learning changed',c.feedbackChanges.map(x=>`${x.kind==='type'?'Recommendation type':'Signal lane'}: ${x.name} · ${signed(x.previousAdjustment)} → ${signed(x.adjustment)} (${x.decisions} decisions)`)));
  const life=c.lifecycle||{};
  if(Number(life.autoCompleted||0)||Number(life.autoReopened||0))sections.push(group('Lifecycle reconciliation',[`${Number(life.autoCompleted||0)} automatically completed · ${Number(life.autoReopened||0)} automatically reopened`]));
  if(!sections.length)sections.push('<div class="empty">No material editorial changes since the previous briefing.</div>');
  body.innerHTML=sections.join('');
}

function group(title,rows){return `<article class="panel" style="padding:14px"><p class="eyebrow">${esc(title)}</p><div style="display:grid;gap:7px;margin-top:8px">${rows.map(row=>`<div style="padding:8px 10px;border:1px solid var(--line,#2b3a35);border-radius:9px;background:rgba(17,26,24,.45)">${esc(row)}</div>`).join('')}</div></article>`;}
function renderEmpty(message){const meta=document.querySelector('#briefingMeta'),summary=document.querySelector('#briefingSummary'),body=document.querySelector('#briefingBody');if(meta)meta.textContent='';if(summary)summary.innerHTML='';if(body)body.innerHTML=`<div class="empty">${esc(message)}</div>`;}

document.addEventListener('DOMContentLoaded',install);
if(document.readyState!=='loading')install();
