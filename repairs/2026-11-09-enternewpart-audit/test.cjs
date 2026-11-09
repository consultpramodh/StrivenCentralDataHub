// Offline Node.js regression test for the exact GitHub ENP candidate. No external writes.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/ENTERNEWPART.js','utf8');
const p={};const ts=[];let seq=0,runs=0,assertions=0;
function eq(a,b){assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));assertions++;}
function yes(v){assert.ok(v);assertions++;}
const ctx={
 Date,JSON,Math,Map,Set,Number,String,Logger:{log(){}},
 PropertiesService:{getScriptProperties(){return {getProperty:k=>p[k]??null,setProperty(k,v){p[k]=String(v)},deleteProperty(k){delete p[k]},getProperties(){return {...p}}};}},
 LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true},releaseLock(){}}}},
 ScriptApp:{getProjectTriggers(){return ts.slice()},deleteTrigger(t){const n=ts.indexOf(t);if(n>=0)ts.splice(n,1)},newTrigger(handler){const t={id:'id'+(++seq),handler,getHandlerFunction(){return this.handler},getUniqueId(){return this.id}};const x={timeBased(){return this},atHour(v){t.hour=v;return this},nearMinute(v){t.minute=v;return this},everyDays(v){t.every=v;return this},inTimezone(v){t.zone=v;return this},create(){ts.push(t);return t}};return x;}},
 Utilities:{formatDate(d,z,f){if(f==='yyyy-MM-dd')return '2026-11-09';throw Error('Unexpected format')}},
};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'ENTERNEWPART.js'});
const parsed=ctx.hub_descParseFields_('Item Number: AA001\\nItem Name: Brass cap\\nPrice: $14.20'.replace(/\\n/g,'\n'));
eq(parsed.itemNumber,'AA001');eq(parsed.name,'Brass cap');eq(parsed.price,14.2);
eq(ctx.hub_descParseMoney_('$1,299.95'),1299.95);eq(ctx.hub_descParseMoney_('not a price'),null);
const engine=ctx.hub_row2LegacyEngine_();
const note='Item Number: AA001\nItem Name: Brass cap\nPrice: $14.20\nCustomer note: retain';
eq(engine.enp_preserveSourceLineDescription_('Brass cap (AA001)',note),note);
eq(engine.enp_preserveSourceLineDescription_('Brass cap (AA001)',''),'Brass cap (AA001)');
assert.throws(()=>engine.enp_hubCheckRequiredFields_({CustomFields:[{Id:775,IsRequired:true,Value:''}]}),/775/);assertions++;
engine.enp_hubCheckRequiredFields_({CustomFields:[{Id:775,IsRequired:true,Value:'No'}]});assertions++;
eq(ctx.hub_scheduleNextEnternewpartRun_(new Date()).triggerCount,3);
eq(ts.map(t=>t.hour),[10,14,16]);yes(ts.every(t=>t.every===1&&t.zone==='America/Toronto'));
ctx.hub_runEnternewpartReportWorker_=()=>{runs++;return {status:'COMPLETE',processed:0}};
eq(ctx.hub_enternewpartScheduledRun({triggerUid:ts[0].id}).slot,10);eq(runs,1);
eq(ctx.hub_enternewpartScheduledRun({triggerUid:ts[0].id}).status,'ALREADY_RAN');eq(runs,1);
eq(ctx.hub_enternewpartScheduledRun({triggerUid:'unrelated'}).status,'UNKNOWN_SCHEDULED_TRIGGER');
eq(ctx.hub_pauseEnternewpartAutomation().removedTriggers,3);eq(ts.length,0);
yes(src.includes('ITEM_GROUP_TRANSACTION_MISMATCH'));
yes(src.includes('if(allResolved)enp_applyCf820ToReplacementPayload_(payload)'));
console.log(JSON.stringify({status:'PASS',assertions,externalCalls:0,externalWrites:0}));
