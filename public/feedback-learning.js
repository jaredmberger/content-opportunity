const FEEDBACK_ENDPOINT='/api/feedback';
let cache=null;
let cacheAt=0;

function esc(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function loadProfile(force=false){
  if(!force&&cache&&Date.now()-cacheAt<30000)return cache;
  const response=await fetch(FEEDBACK_ENDPOINT,{cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.ok===false)throw new Error(data?.error||`Feedback endpoint returned ${response.status}`);
  cache=data.profile||null;cacheAt=Date.now();return cache;
}

function activeRules(profile){
  const rules=[];
  for(const [type,value] of Object.entries(profile?.byType||{}))if(value?.active)rules.push({label:`${type} recommendations`,...value});
  for(const [lane,value] of Object.entries(profile?.byLane||{}))if(value?.active)rules.push({label:lane.replace(/-/g,' '),...value});
  return rules.sort((a,b)=>Math.abs(Number(b.adjustment||0))-Math.abs(Number(a.adjustment||0))||a.label.localeCompare(b.label));
}

function ensurePanel(){
  let panel=document.querySelector('#feedbackLearning');
  if(panel)return panel;
  const summary=document.querySelector('#summary');
  if(!summary)return null;
  panel=document.createElement('section');
  panel.id='feedbackLearning';
  panel.className='panel';
  panel.style.cssText='margin:14px 0;padding:16px 18px';
  summary.insertAdjacentElement('afterend',panel);
  return panel;
}

function render(profile){
  const panel=ensurePanel();if(!panel)return;
  const decisions=Number(profile?.decisions||0),minimum=Number(profile?.minimumDecisions||4),rules=activeRules(profile);
  const status=decisions<minimum?`Collecting history · ${decisions}/${minimum} preference-bearing decisions before any adjustment activates`:`${decisions} decisions observed · adjustments capped at ±${profile.maximumAdjustment||5} points`;
  panel.innerHTML=`<div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap"><div><p class="eyebrow" style="margin-bottom:4px">Curator Feedback</p><h3 style="margin:0 0 6px">Transparent preference learning</h3><p class="hint" style="margin:0;max-width:760px">${esc(status)}. Accepted / in-progress / completed work counts positively; deferred / dismissed work counts negatively. This never replaces evidence scoring.</p></div><span class="badge">bounded learning</span></div>${rules.length?`<div class="evidence" style="margin-top:12px">${rules.map(rule=>`<div class="evidence-item"><strong>${esc(rule.label)}</strong>${Number(rule.adjustment)>0?'+':''}${esc(rule.adjustment)} points · ${esc(rule.positive)}/${esc(rule.decisions)} positive decisions</div>`).join('')}</div>`:`<p class="hint" style="margin-top:10px">No active ranking adjustments yet.</p>`}`;
}

async function refresh(){try{render(await loadProfile(true));}catch(error){console.warn('Feedback learning unavailable:',error);}}

async function discoveryMap(){
  const response=await fetch('/api/discover',{cache:'no-store'});if(!response.ok)return new Map();const data=await response.json();return new Map((data.opportunities||[]).map(item=>[String(item.id),item]));
}

async function recordDecision(card,status){
  if(!['accepted','in-progress','completed','deferred','dismissed'].includes(status))return;
  const id=card?.dataset?.id;if(!id)return;
  try{
    const map=await discoveryMap();const item=map.get(id);if(!item)return;
    const response=await fetch(FEEDBACK_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,workflowStatus:status,opportunityType:item.type||'',signalLanes:item.prioritization?.signalLanes||[],cluster:item.cluster||'',canonicalUrl:item.canonicalUrl||'',recommendation:item.recommendation||''})});
    if(!response.ok)throw new Error(`Feedback endpoint returned ${response.status}`);
    cache=null;await refresh();
  }catch(error){console.warn('Curator feedback decision not recorded:',error);}
}

document.addEventListener('click',event=>{
  const button=event.target.closest?.('.save-workflow');if(!button)return;
  const card=button.closest('.opportunity');const status=card?.querySelector('.workflow-status')?.value||'';
  setTimeout(()=>recordDecision(card,status),500);
});

refresh();
