/* Google Apps Script — Central Hub manual controls and Toronto business-hour schedule. */
function hub_previewEnternewpartAutomation() {
 const result=hub_row2LegacyEngine_().enp_hubPreviewAllRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_processEnternewpartAutomation(event) {
 // A previously installed five-minute callback migrates itself on its next tick.
 if(event&&event.triggerUid)return hub_enternewpartScheduledRun(event);
 const result=hub_row2LegacyEngine_().enp_hubRunEligibleRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_nextEnternewpartRun_(now) {
 const zone='America/Toronto',hours=[8,10,12,14,16,18],day=Utilities.formatDate(now,zone,'yyyy-MM-dd').split('-').map(Number);
 for(let delta=0;delta<3;delta++)for(const hour of hours){
  const guess=Date.UTC(day[0],day[1]-1,day[2]+delta,hour,0,0);
  const offset=Utilities.formatDate(new Date(guess),zone,'Z'),match=/^([+-])(\d{2})(\d{2})$/.exec(offset);
  if(!match)throw new Error('Invalid Toronto timezone offset');
  const minutes=(Number(match[2])*60+Number(match[3]))*(match[1]==='-'?-1:1);
  const candidate=new Date(guess-minutes*60000);
  if(candidate.getTime()>now.getTime())return candidate;
 }
 throw new Error('Could not calculate the next Toronto run');
}
function hub_scheduleNextEnternewpartRun_(now) {
 const lock=LockService.getScriptLock();lock.waitLock(1000);
 try{
  const next=hub_nextEnternewpartRun_(now),old=ScriptApp.getProjectTriggers().filter(function(t){
   return ['hub_processEnternewpartAutomation','hub_enternewpartScheduledRun'].indexOf(t.getHandlerFunction())>=0;
  });
  const created=ScriptApp.newTrigger('hub_enternewpartScheduledRun').timeBased().at(next).create();
  if(!created||!created.getUniqueId())throw new Error('Timer creation returned no trigger ID');
  const id=created.getUniqueId();
  old.forEach(function(t){if(t.getUniqueId()!==id)ScriptApp.deleteTrigger(t);});
  const verified=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='hub_enternewpartScheduledRun';});
  if(verified.length!==1||verified[0].getUniqueId()!==id)throw new Error('Automatic worker timer failed verification');
  PropertiesService.getScriptProperties().setProperty('HUB_ENP_NEXT_RUN_AT',next.toISOString());
  return {nextRunUTC:next.toISOString(),nextRunLocal:Utilities.formatDate(next,'America/Toronto','yyyy-MM-dd HH:mm'),timezone:'America/Toronto',hours:[8,10,12,14,16,18]};
 }finally{lock.releaseLock();}
}
function hub_enternewpartScheduledRun() {
 const props=PropertiesService.getScriptProperties();
 if(props.getProperty('HUB_ENP_AUTOMATION_ENABLED')==='false')return {status:'PAUSED',processed:0};
 const now=new Date(),due=Date.parse(props.getProperty('HUB_ENP_NEXT_RUN_AT')||'');
 // Re-arm before business work so a failed row does not stop future runs.
 const next=hub_scheduleNextEnternewpartRun_(now);
 if(!Number.isFinite(due)||now.getTime()<due-1000||now.getTime()-due>60*60*1000){
  const out={status:'RESCHEDULED',processed:0,next:next};Logger.log(JSON.stringify(out));return out;
 }
 const result=hub_row2LegacyEngine_().enp_hubRunEligibleRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_enableEnternewpartAutomation() {
 const props=PropertiesService.getScriptProperties(),next=hub_scheduleNextEnternewpartRun_(new Date());
 props.setProperty('HUB_ENP_AUTOMATION_ENABLED','true');
 const preview=hub_previewEnternewpartAutomation(),result={status:'INSTALLED',schedule:next,maxRowsPerRun:2,eligible:preview.eligible,completed:preview.completed,review:preview.review||0,held:preview.held||0,mode:'AUTO_VALIDATED'};
 Logger.log(JSON.stringify(result));return result;
}
function hub_pauseEnternewpartAutomation() {
 PropertiesService.getScriptProperties().setProperty('HUB_ENP_AUTOMATION_ENABLED','false');
 const result={status:'PAUSED',strivenCalls:0};Logger.log(JSON.stringify(result));return result;
}
