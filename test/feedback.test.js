import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackProfile, applyFeedbackAdjustments } from '../src/feedback.js';

const record=(id,status,type='connect',lanes=['link-map'])=>({id,workflowStatus:status,opportunityType:type,signalLanes:lanes});
const opportunity=(score=60,type='connect',lanes=['link-map'])=>({id:'x',title:'Example',type,score,decisionScore:score,prioritization:{decisionScore:score,independentSignals:lanes.length,signalLanes:lanes}});

test('feedback does not activate before four decisions',()=>{
  const profile=buildFeedbackProfile([record('1','accepted'),record('2','accepted'),record('3','dismissed')]);
  assert.equal(profile.byType.connect.adjustment,0);
  assert.equal(profile.byType.connect.active,false);
});

test('positive repeated decisions create a bounded upward adjustment',()=>{
  const profile=buildFeedbackProfile([record('1','accepted'),record('2','completed'),record('3','accepted'),record('4','in-progress')]);
  const [result]=applyFeedbackAdjustments([opportunity()],profile);
  assert.equal(profile.byType.connect.adjustment,5);
  assert.equal(result.prioritization.feedbackAdjustment,5);
  assert.equal(result.decisionScore,65);
});

test('negative repeated decisions create a bounded downward adjustment',()=>{
  const profile=buildFeedbackProfile([record('1','dismissed'),record('2','deferred'),record('3','dismissed'),record('4','deferred')]);
  const [result]=applyFeedbackAdjustments([opportunity()],profile);
  assert.equal(profile.byType.connect.adjustment,-5);
  assert.equal(result.prioritization.feedbackAdjustment,-5);
  assert.equal(result.decisionScore,55);
});

test('combined type and lane effects remain capped at five points',()=>{
  const records=[];
  for(let i=0;i<4;i++)records.push(record(`a${i}`,'accepted','connect',['link-map']));
  const profile=buildFeedbackProfile(records);
  const [result]=applyFeedbackAdjustments([opportunity()],profile);
  assert.equal(result.prioritization.feedbackAdjustment,5);
});
