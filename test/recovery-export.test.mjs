import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker.js';

function makeStore(values){
  const keys=Object.keys(values).sort();
  return{
    async list({cursor}={}){
      if(!cursor)return{keys:keys.slice(0,2).map(name=>({name})),list_complete:keys.length<=2,cursor:'next'};
      return{keys:keys.slice(2).map(name=>({name})),list_complete:true,cursor:''};
    },
    async get(key,options){
      assert.equal(options?.type,'text');
      return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null;
    },
    async put(){}
  };
}

test('recovery export is disabled without RECOVERY_EXPORT_TOKEN',async()=>{
  const response=await worker.fetch(new Request('https://example.test/api/recovery-export'),{OPPORTUNITY_STATE:makeStore({})});
  assert.equal(response.status,503);
});

test('recovery export rejects a bad token',async()=>{
  const response=await worker.fetch(new Request('https://example.test/api/recovery-export',{headers:{'x-curator-recovery-key':'wrong'}}),{
    RECOVERY_EXPORT_TOKEN:'right',
    OPPORTUNITY_STATE:makeStore({})
  });
  assert.equal(response.status,401);
});

test('recovery export paginates and preserves raw KV JSON values',async()=>{
  const values={
    'content-opportunity:workflow:alpha':JSON.stringify({id:'alpha',workflowStatus:'accepted'}),
    'content-opportunity:feedback:alpha':JSON.stringify({id:'alpha',workflowStatus:'accepted'}),
    'content-opportunity:discovery-snapshot:v1':JSON.stringify({generatedAt:'2026-09-26T00:00:00.000Z'})
  };
  const response=await worker.fetch(new Request('https://example.test/api/recovery-export',{headers:{'x-curator-recovery-key':'secret'}}),{
    RECOVERY_EXPORT_TOKEN:'secret',
    OPPORTUNITY_STATE:makeStore(values)
  });
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.format,'content-opportunity-kv-recovery');
  assert.equal(body.summary.keyCount,3);
  assert.equal(body.summary.categories.workflow,1);
  assert.equal(body.summary.categories.feedback,1);
  assert.equal(body.summary.categories.discoverySnapshot,1);
  assert.deepEqual(body.data.entries.map(x=>x.key),Object.keys(values).sort());
  assert.match(body.integrity.dataSha256,/^[a-f0-9]{64}$/);
});
