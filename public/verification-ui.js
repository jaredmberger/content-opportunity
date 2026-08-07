const VERIFICATION_ENDPOINT='https://search-intelligence.oceanliners.net/api/outcomes?verify=1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=(value,digits=0)=>{const n=Number(value||0);return`${n>0?'+':''}${n.toFixed(digits)}`};
const pct=value=>`${signed(value,0)}%`;

function install(){
  if(document.querySelector('#verificationPanel'))return;
  const anchor=document.querySelector('#summary');
  if(!anchor)return;
  const section=document.createElement('section');
  section.id='verificationPanel';
  section.className='panel';
  section.style.cssText='margin:18px 0;padding:18px';
  section.innerHTML=`
    <div style="display:flex;gap:16px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
      <div><p class="eyebrow">Verification</p><h2 style="margin:.2rem 0 .4rem">What happened after we acted?</h2><p style="margin:0;color:var(--muted,#b7b6ad);max-width:760px">Implemented recommendations are compared with their saved baseline using current Search Intelligence and Link Map evidence. Observed change is not treated as proof of causation.</p></div>
      <button id="refreshVerification" class="secondary">Refresh verification</button>
    </div>
    <div id="verificationSummary" class="summary-grid" style="margin-top:16px"></div>
    <div id="verificationList" style="display:grid;gap:10px;margin-top:14px"><div class="empty">Loading verification history…</div></div>`;
  anchor.insertAdjacentElement('afterend',section);
  section.querySelector('#refreshVerification')?.addEventListener('click',loadVerification);
  loadVerification();
}

async function loadVerification(){
  const list=document.querySelector('#verificationList');
  const summary=document.querySelector('#verificationSummary');
  const button=document.querySelector('#refreshVerification');
  if(!list||!summary)return;
  if(button){button.disabled=true;button.textContent='Refreshing…';}
  try{
    const response=await fetch(VERIFICATION_ENDPOINT,{cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok===false)throw new Error(data?.error||`Verification endpoint returned ${response.status}`);
    renderSummary(summary,data.summary||{});
    renderList(list,data.records||[],data.sources||{});
  }catch(error){
    summary.innerHTML='';
    list.innerHTML=`<div class="empty">Verification is unavailable: ${esc(error.message)}</div>`;
  }finally{
    if(button){button.disabled=false;button.textContent='Refresh verification';}
  }
}

function renderSummary(root,s){
  const cards=[
    ['Implemented',s.implemented||0],['Ready',s.ready||0],['Improved',s.improved||0],['Mixed',s.mixed||0],['Declined',s.declined||0],['Waiting',s.waiting||0]
  ];
  root.innerHTML=cards.map(([label,value])=>`<article class="summary-card panel"><strong>${esc(value)}</strong><span>${esc(label)}</span></article>`).join('');
}

function renderList(root,records,sources){
  const implemented=records.filter(r=>r.status==='implemented');
  if(!implemented.length){
    root.innerHTML='<div class="empty">No implemented interventions are ready for verification yet. Move a measurable existing-page opportunity into In Progress or Completed to begin tracking.</div>';
    return;
  }
  implemented.sort((a,b)=>verificationOrder(a)-verificationOrder(b)||String(b.implementedAt||'').localeCompare(String(a.implementedAt||'')));
  const sourceNote=`Search snapshot ${sources.searchIntelligence?.snapshotDate||'unavailable'} · Link Map ${sources.linkMap?.available?`${sources.linkMap.pageCount||0} pages`:'unavailable'}`;
  root.innerHTML=`<p style="margin:0 0 2px;color:var(--muted,#b7b6ad);font-size:.78rem">${esc(sourceNote)}</p>`+implemented.map(record=>verificationCard(record)).join('');
}

function verificationOrder(record){
  const state=record.verification?.state||'insufficient';
  return({improved:0,mixed:1,declined:2,unchanged:3,waiting:4,insufficient:5}[state]??6);
}

function verificationCard(record){
  const v=record.verification||{};
  const state=v.state||'insufficient';
  const label=v.label||state;
  const border=state==='improved'?'rgba(141,182,143,.45)':state==='declined'?'rgba(209,121,121,.45)':state==='mixed'?'rgba(191,164,106,.45)':'var(--line,#2b3a35)';
  return `<article style="border:1px solid ${border};border-radius:12px;padding:14px;background:rgba(17,26,24,.55)">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div><span class="badge">${esc(label)}</span>${v.checkpoint?`<span class="badge">${esc(v.checkpoint)} checkpoint</span>`:''}${Number(v.ageDays)>=0?`<span class="badge">${esc(v.ageDays)} days</span>`:''}</div>
      <h3 style="margin:.55rem 0 .3rem">${esc(record.page||record.query||'Tracked intervention')}</h3>
      <p style="margin:0;color:var(--muted,#b7b6ad)">${esc(record.recommendation||'')}</p></div>
      ${record.page?`<a class="secondary" style="text-decoration:none" href="${esc(record.page)}" target="_blank" rel="noopener">Open page ↗</a>`:''}
    </div>
    <p style="margin:.7rem 0 0;font-size:.82rem;color:var(--muted,#b7b6ad)">${esc(v.detail||'')}</p>
    <div class="evidence" style="margin-top:10px">${searchMarkup(v.search)}${linkMarkup(v.links)}</div>
    ${record.notes?`<p style="margin:.65rem 0 0;font-size:.8rem"><strong>Intervention note:</strong> ${esc(record.notes)}</p>`:''}
  </article>`;
}

function searchMarkup(search){
  if(!search?.available)return `<div class="evidence-item"><strong>Search Intelligence</strong>${esc(search?.reason||'No comparable search evidence')}</div>`;
  const d=search.delta||{};
  const c=search.current||{};
  return `<div class="evidence-item"><strong>Search · ${esc(search.direction)}</strong>Clicks ${pct(d.clicksPct)} · impressions ${pct(d.impressionsPct)} · rank ${signed(d.position,1)} · CTR ${signed(d.ctr,1)} pts<br><span style="font-size:.72rem;color:var(--muted,#b7b6ad)">Current: ${esc(c.clicks||0)} clicks · ${esc(c.impressions||0)} impressions · #${esc(Number(c.position||0).toFixed(1))}</span></div>`;
}

function linkMarkup(links){
  if(!links?.available)return `<div class="evidence-item"><strong>Link Map</strong>${esc(links?.reason||'No comparable link evidence')}</div>`;
  const d=links.delta||{};
  const c=links.current||{};
  return `<div class="evidence-item"><strong>Link Map · ${esc(links.direction)}</strong>Inbound ${signed(d.incomingLinks)} · outbound ${signed(d.outgoingLinks)} · neighbors ${signed(d.totalNeighbors)}<br><span style="font-size:.72rem;color:var(--muted,#b7b6ad)">Current: ${esc(c.incomingLinks||0)} inbound · ${esc(c.outgoingLinks||0)} outbound · ${esc(c.totalNeighbors||0)} neighbors</span></div>`;
}

document.addEventListener('DOMContentLoaded',install);
if(document.readyState!=='loading')install();
window.addEventListener('focus',()=>{if(document.querySelector('#verificationPanel'))loadVerification();});
