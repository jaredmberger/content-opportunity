const PANEL_ID='work-next-panel';
const MAX_ITEMS=5;

function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));}

function ensureStyles(){
  if(document.querySelector('#work-next-styles'))return;
  const style=document.createElement('style');
  style.id='work-next-styles';
  style.textContent=`
    .work-next-panel{margin:20px 0;padding:20px;border:1px solid rgba(191,164,106,.35);border-radius:18px;background:linear-gradient(180deg,rgba(191,164,106,.08),rgba(17,26,24,.9));}
    .work-next-head{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;margin-bottom:14px}.work-next-head h2{margin:.15rem 0 .35rem}.work-next-head p{margin:0;color:var(--muted,#b7b6ad);max-width:760px}
    .work-next-list{display:grid;gap:10px}.work-next-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:start;padding:14px;border:1px solid var(--line,#2b3a35);border-radius:14px;background:rgba(10,17,16,.72)}
    .work-next-rank{width:42px;height:42px;display:grid;place-items:center;border:1px solid rgba(191,164,106,.5);border-radius:12px;color:var(--brass,#bfa46a);font-weight:800}.work-next-copy h3{margin:0 0 5px}.work-next-copy p{margin:0 0 8px;color:var(--muted,#b7b6ad);line-height:1.4}.work-next-meta{display:flex;gap:6px;flex-wrap:wrap}.work-next-meta span{font-size:.7rem;border:1px solid var(--line,#2b3a35);border-radius:999px;padding:4px 7px;color:var(--muted,#b7b6ad)}
    .work-next-actions{display:grid;gap:7px;min-width:150px}.work-next-actions button,.work-next-actions a{display:block;text-align:center;text-decoration:none;border:1px solid var(--line,#2b3a35);border-radius:10px;padding:9px 10px;background:var(--panel2,#17221f);color:var(--text,#f3efe5);cursor:pointer}.work-next-actions .primary{background:var(--brass,#bfa46a);border-color:var(--brass,#bfa46a);color:#17130c;font-weight:700}.work-next-empty{padding:18px;text-align:center;color:var(--muted,#b7b6ad)}
    @media(max-width:760px){.work-next-item{grid-template-columns:auto minmax(0,1fr)}.work-next-actions{grid-column:1/-1;grid-template-columns:1fr 1fr}.work-next-head{display:block}.work-next-head .eyebrow{margin-bottom:4px}}
  `;
  document.head.appendChild(style);
}

function ensurePanel(){
  let panel=document.querySelector(`#${PANEL_ID}`);
  if(panel)return panel;
  panel=document.createElement('section');
  panel.id=PANEL_ID;
  panel.className='work-next-panel';
  panel.innerHTML=`<div class="work-next-head"><div><p class="eyebrow">CuratorOS · Decision Surface</p><h2>Work Next</h2><p>The highest-confidence actions where independent CuratorOS signals converge.</p></div></div><div class="work-next-list"><div class="work-next-empty">Loading ranked recommendations…</div></div>`;
  const summary=document.querySelector('#summary');
  if(summary)summary.parentNode.insertBefore(panel,summary);
  else document.querySelector('main')?.appendChild(panel);
  return panel;
}

function curatorHandoff(item,workspace,action){
  const url=new URL('https://curator.oceanliners.net/');
  url.searchParams.set('workspace',workspace);
  url.searchParams.set('subject',item.title||'');
  if(item.canonicalUrl)url.searchParams.set('page',item.canonicalUrl);
  url.searchParams.set('action',action||item.type||'review');
  url.searchParams.set('source','content-opportunity');
  if(item.recommendation)url.searchParams.set('recommendation',item.recommendation.slice(0,500));
  return url.href;
}

function handoffFor(item){
  if(item.type==='connect'&&item.canonicalUrl){
    const url=new URL('https://link-map.oceanliners.net/');
    url.searchParams.set('page',item.canonicalUrl);
    return {label:'Start in Link Map',url:url.href,tool:'Link Map'};
  }
  if(item.type==='research'){
    const workspace=item.projectRecordEvidence?'evidence-ledger':'records';
    return {label:item.projectRecordEvidence?'Start in Evidence & Conflicts':'Start in Project Records',url:curatorHandoff(item,workspace,'research'),tool:'CuratorOS'};
  }
  if(item.type==='create'){
    return {label:'Start in Publication Composer',url:curatorHandoff(item,'publication-composer','create'),tool:'CuratorOS'};
  }
  return {label:'Start in Page Assembly',url:curatorHandoff(item,'page-assembly','expand'),tool:'CuratorOS'};
}

async function markInProgress(item){
  try{
    await fetch(`/api/workflow/${encodeURIComponent(item.id)}`,{
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({workflowStatus:'in-progress',notes:item.notes||''})
    });
  }catch{}
}

function render(data){
  ensureStyles();
  const panel=ensurePanel();
  const list=panel.querySelector('.work-next-list');
  const items=(data?.opportunities||[]).filter(item=>['new','reviewed','accepted','in-progress'].includes(item.workflowStatus||'new')).slice(0,MAX_ITEMS);
  if(!items.length){list.innerHTML='<div class="work-next-empty">No active ranked recommendations are available right now.</div>';return;}
  list.innerHTML=items.map(item=>{
    const p=item.prioritization||{};
    const lanes=(p.signalLanes||[]).map(x=>x.replace(/-/g,' '));
    const handoff=handoffFor(item);
    return `<article class="work-next-item" data-id="${esc(item.id)}"><div class="work-next-rank">#${esc(item.workNextRank||'—')}</div><div class="work-next-copy"><h3>${esc(item.title)}</h3><p>${esc(item.recommendation||'')}</p><div class="work-next-meta"><span>decision ${esc(item.decisionScore??item.score)}</span><span>base ${esc(item.score)}</span><span>${esc(p.independentSignals||1)} signal${Number(p.independentSignals||1)===1?'':'s'}</span>${lanes.map(l=>`<span>${esc(l)}</span>`).join('')}</div></div><div class="work-next-actions"><button class="primary" data-start="${esc(item.id)}">${esc(handoff.label)}</button>${item.canonicalUrl?`<a href="${esc(item.canonicalUrl)}" target="_blank" rel="noopener">Open page</a>`:''}</div></article>`;
  }).join('');
  for(const item of items){
    const button=list.querySelector(`[data-start="${CSS.escape(item.id)}"]`);
    if(!button)continue;
    const handoff=handoffFor(item);
    button.addEventListener('click',()=>{
      window.open(handoff.url,'_blank','noopener');
      markInProgress(item);
      button.textContent=`Opened ${handoff.tool}`;
    });
  }
}

async function refresh(){
  ensureStyles();
  ensurePanel();
  try{
    const response=await fetch('/api/discover',{cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.detail||data.error||'Discovery failed');
    render(data);
  }catch(error){
    const panel=ensurePanel();
    panel.querySelector('.work-next-list').innerHTML=`<div class="work-next-empty">Work Next could not refresh: ${esc(error.message)}</div>`;
  }
}

const discover=document.querySelector('#discover');
if(discover)discover.addEventListener('click',()=>setTimeout(refresh,1200));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh);
else refresh();
