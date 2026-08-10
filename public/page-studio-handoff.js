(() => {
  'use strict';
  const STUDIO='https://page-studio.oceanliners.net/';
  const eligible=item=>['accepted','in-progress'].includes(item.workflowStatus||'new')&&['expand','connect'].includes(String(item.type||item.opportunityType||'').toLowerCase())&&Boolean(item.canonicalUrl);
  function studioUrl(item){
    let page;try{page=new URL(item.canonicalUrl,'https://www.oceanliners.net')}catch{return''}
    if(!['oceanliners.net','www.oceanliners.net'].includes(page.hostname.toLowerCase()))return'';
    const q=new URLSearchParams({source:'content-opportunity',url:page.href,opportunity_id:item.id||'',opportunity_type:item.type||item.opportunityType||'',finding_title:item.title||'Content Opportunity',finding_category:`${String(item.type||item.opportunityType||'').toUpperCase()} opportunity`,recommendation:item.recommendation||'',rationale:item.rationale||'',notes:item.notes||''});
    return `${STUDIO}?${q}`;
  }
  function inject(){
    const items=window.__CONTENT_OPPORTUNITY_ITEMS__||[];
    document.querySelectorAll('.opportunity[data-id]').forEach(card=>{
      if(card.querySelector('.page-studio-handoff'))return;
      const item=items.find(x=>String(x.id)===String(card.dataset.id));if(!item||!eligible(item))return;
      const href=studioUrl(item);if(!href)return;
      const editor=card.querySelector('.workflow-editor');if(!editor)return;
      const a=document.createElement('a');a.className='page-studio-handoff secondary';a.href=href;a.textContent='Open in Page Studio →';a.setAttribute('aria-label',`Open ${item.title||'this opportunity'} in Page Studio`);editor.appendChild(a);
    });
  }
  window.addEventListener('content-opportunity:render',inject);
  window.addEventListener('load',()=>setTimeout(inject,1200));
})();
