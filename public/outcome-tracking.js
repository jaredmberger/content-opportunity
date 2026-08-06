const OUTCOME_ENDPOINT='https://search-intelligence.oceanliners.net/api/outcomes';
const TRACKED_STATUSES=new Set(['accepted','in-progress','completed']);
let opportunityCache=null;
let opportunityCacheAt=0;

function outcomeStatus(workflowStatus){
  if(workflowStatus==='accepted')return'planned';
  if(workflowStatus==='in-progress'||workflowStatus==='completed')return'implemented';
  return null;
}

async function loadOpportunities(){
  if(opportunityCache&&Date.now()-opportunityCacheAt<5*60*1000)return opportunityCache;
  const response=await fetch('/api/discover',{cache:'no-store'});
  if(!response.ok)throw new Error(`Discovery returned ${response.status}`);
  const data=await response.json();
  opportunityCache=new Map((data.opportunities||[]).map(item=>[String(item.id),item]));
  opportunityCacheAt=Date.now();
  return opportunityCache;
}

function baselineFor(item){
  return{
    capturedAt:new Date().toISOString(),
    search:{
      clicks:Number(item.searchClicks||0),
      impressions:Number(item.searchImpressions||0),
      ctr:Number(item.searchCtr||0),
      averagePosition:Number(item.averagePosition||0),
      queryCount:Number(item.searchQueryCount||0)
    },
    linkMap:item.graphEvidence?{
      incomingLinks:Number(item.graphEvidence.incomingLinks||0),
      outgoingLinks:Number(item.graphEvidence.outgoingLinks||0),
      totalNeighbors:Number(item.graphEvidence.totalNeighbors||0),
      sharedNeighborStrength:Number(item.graphEvidence.sharedNeighborStrength||0)
    }:null,
    siteInventory:{
      resolved:Boolean(item.inventoryResolved),
      canonicalVerified:Boolean(item.siteInventoryMatch)
    },
    decision:{
      decisionScore:Number(item.decisionScore??item.score??0),
      baseScore:Number(item.score||0),
      workNextRank:Number(item.workNextRank||0),
      independentSignals:Number(item.prioritization?.independentSignals||0),
      signalLanes:Array.isArray(item.prioritization?.signalLanes)?item.prioritization.signalLanes:[]
    }
  };
}

async function recordOutcome(card,status,button){
  if(!TRACKED_STATUSES.has(status))return;
  const id=card?.dataset?.id;
  if(!id)return;
  try{
    const items=await loadOpportunities();
    const item=items.get(id);
    if(!item?.canonicalUrl)return;
    const payload={
      id:`content-opportunity-${id}`,
      page:item.canonicalUrl,
      recommendation:item.recommendation||'',
      status:outcomeStatus(status),
      notes:card.querySelector('.workflow-notes')?.value?.trim()||'',
      priorityScore:Number(item.score||0),
      decisionScore:Number(item.decisionScore??item.score??0),
      source:'Content Opportunity Finder',
      opportunityId:id,
      opportunityType:item.type||'',
      signalLanes:Array.isArray(item.prioritization?.signalLanes)?item.prioritization.signalLanes:[],
      baseline:baselineFor(item)
    };
    const response=await fetch(OUTCOME_ENDPOINT,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),
      cache:'no-store'
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok===false)throw new Error(data?.error||`Outcome endpoint returned ${response.status}`);
    card.dataset.outcomeTracked='true';
    let note=card.querySelector('.outcome-tracking-note');
    if(!note){
      note=document.createElement('span');
      note.className='outcome-tracking-note';
      note.style.cssText='display:inline-block;margin-left:8px;font-size:.72rem;color:var(--muted,#b7b6ad)';
      button?.insertAdjacentElement('afterend',note);
    }
    note.textContent=payload.status==='implemented'?'Outcome baseline recorded · implementation tracked':'Outcome baseline recorded · planned';
  }catch(error){
    console.warn('Content Opportunity outcome tracking skipped:',error);
  }
}

document.addEventListener('click',event=>{
  const button=event.target.closest?.('.save-workflow');
  if(!button)return;
  const card=button.closest('.opportunity');
  const status=card?.querySelector('.workflow-status')?.value||'';
  if(!TRACKED_STATUSES.has(status))return;
  setTimeout(()=>recordOutcome(card,status,button),350);
});
