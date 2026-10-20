// JavaScript / Node.js — read-only tests of a supplied live source snapshot.
// Usage: node test_rules.cjs /absolute/path/to/SNAPSHOT/ENP/src
// All IDs in test fixtures are synthetic. No Apps Script function may call a network.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const dir=process.argv[2];if(!dir)throw Error('Supply live snapshot source directory');
let networkAttempts=0;
const makeContext=()=>vm.createContext({console:{log(){},error(){}},Logger:{log(){}},UrlFetchApp:{fetch(){networkAttempts++;throw Error('NETWORK FORBIDDEN IN AUDIT');}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='ENTERNEWPART_DEFAULT_ITEMTYPE_ID'?'9001':k==='ENTERNEWPART_DEFAULT_INVENTORY_LOCATION_ID'?'9002':null})}});
const context=makeContext();
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js')).sort();
const definitions={},fileResults=[];
for(const file of files){
 const source=fs.readFileSync(path.join(dir,file),'utf8'),isolated=makeContext();
 new vm.Script(source,{filename:file});
 vm.runInContext(source,isolated,{filename:file});
 const functions=Object.keys(isolated).filter(k=>typeof isolated[k]==='function');
 for(const name of functions){if(!definitions[name])definitions[name]=[];definitions[name].push({file,source:isolated[name].toString()});}
 fileResults.push({file,sha256:crypto.createHash('sha256').update(source).digest('hex'),functions:functions.length});
 vm.runInContext(source,context,{filename:file});
}
const duplicates=Object.entries(definitions).filter(([,d])=>d.length>1).map(([name,d])=>({name,files:d.map(x=>x.file),differentBodies:new Set(d.map(x=>x.source)).size>1}));
const plain=x=>JSON.parse(JSON.stringify(x));let checks=0;const findings=[];
function test(name,fn){fn();checks++;console.log('PASS '+name);}
const c=context;
test('standard description: ordered labels and valid price required',()=>{
 assert(c.enp_guardIsStandardDescription_('Item Number: ABC\nItem Name: Part\nPrice: $1,234.56'));
 assert(!c.enp_guardIsStandardDescription_('ABC Part $10'));
 assert(!c.enp_guardIsStandardDescription_('Item Name: Part\nItem Number: ABC\nPrice: $10'));
 assert(!c.enp_guardIsStandardDescription_('Item Number: ABC\nItem Name: Part\nPrice:'));
 assert.equal(c.enp_parseDescription_('Item Number: ABC\nItem Name: Part\nPrice: $1,234.56').price,1234.56);
});
test('canonical creation name is idempotent',()=>assert.equal(c.enp_guardCanonicalName_('Part (ABC)','ABC'),'Part (ABC)'));
test('Quoted queue requires actual boolean authorization',()=>{
 const col={ItemNumber:0,LastAction:1,NewItemId:2,SendToActions:3};
 const sheet={getName:()=> 'Enternewpart_Quoted'};
 assert(!c.enp_sourceRowShouldQueue_(sheet,['ENTERNEWPART','','','TRUE'],col));
 assert(c.enp_sourceRowShouldQueue_(sheet,['ENTERNEWPART','','',true],col));
 assert(!c.enp_sourceRowShouldQueue_(sheet,['ENTERNEWPART','DONE','',true],col));
});
test('exact labeled part and quantity select only intended SO line',()=>{
 const a={id:1,item:{id:36935},qty:2,description:'Item Number: ABC\nItem Name: Part\nPrice: $10'};
 const b={id:2,item:{id:36935},qty:2,description:'Item Number: DEF\nItem Name: mentions ABC\nPrice: $10'};
 assert.equal(c.enp_findTargetPlaceholderLine_([a,b],{desiredItemNumber:'ABC',desiredQty:2,newItemId:9003}).id,1);
 assert.equal(c.enp_findTargetPlaceholderLine_([a],{desiredItemNumber:'ABC',desiredQty:3,newItemId:9003}),null);
 assert.throws(()=>c.enp_findTargetPlaceholderLine_([a,{...a,id:3}],{desiredItemNumber:'ABC',desiredQty:2,newItemId:9003}),/Ambiguous/);
 assert.throws(()=>c.enp_findTargetPlaceholderLine_([a,b],{lineId:2,desiredItemNumber:'ABC',desiredQty:2,newItemId:9003}),/does not match/);
});
test('line replacement preserves quantity and uses requested price',()=>{
 const line={id:1,item:{id:36935},qty:2,price:1,inventoryLocation:{id:9002,name:'Fixture'}};
 c.enp_applyReplacementToLine_(line,{newItemId:9003,desiredItemName:'Part',desiredItemNumber:'ABC',desiredPrice:10},{id:9003,name:'Part (ABC)',itemType:{id:9001,name:'Inventory'}});
 assert.equal(line.qty,2);assert.equal(line.price,10);assert.equal(line.item.id,9003);
 assert.equal(line.description,'Part (ABC)');
 assert.throws(()=>c.enp_applyReplacementToLine_(line,{newItemId:9004},{id:9004,itemType:{id:5,name:'Item Group'}}),/Item Group/);
});
test('custom field mapping preserves false, zero, options and required flag',()=>{
 const x=c.enp_mapCustomFieldForPost_({id:775,name:'Fixture',isRequired:true,booleanValue:false,valueNumber:0,value:'',optionIds:[1,2]});
 assert.equal(x.Id,775);assert.equal(x.BooleanValue,false);assert.equal(x.ValueNumber,0);assert.equal(x.IsRequired,true);assert.deepEqual(plain(x.OptionIds),[1,2]);
});
test('CF820 updates one field and preserves other outgoing fields',()=>{
 const input={CustomFields:[{Id:775,Value:'keep'},{Id:831,ValueNumber:0},{Id:820,Value:'old',ValueText:'old'}]};
 const result=c.enp_applyCf820ToReplacementPayload_(input);
 assert.equal(result.CustomFields.length,3);
 assert.equal(result.CustomFields[2].Value,'556');assert.equal(result.CustomFields[2].ValueText,'New Items created + SO Updated');
 assert.equal(result.CustomFields[0].Value,'keep');assert.equal(result.CustomFields[1].ValueNumber,0);
});
test('missing CF820 is added; applying twice does not add another field',()=>{
 const p={CustomFields:[{Id:775,Value:'keep'}]};c.enp_applyCf820ToReplacementPayload_(p);c.enp_applyCf820ToReplacementPayload_(p);
 assert.equal(p.CustomFields.filter(x=>x.Id===820).length,1);
});
const beforeLine={id:1,item:{id:36935},qty:2,price:1,description:'Item Number: ABC\nItem Name: Part\nPrice: $10'};
const afterLine={id:1,item:{id:9003},qty:2,price:10,description:'Part (ABC)'};
const beforeSO={customFields:[{id:775,isRequired:true,value:'keep'},{id:820,value:'old'}]};
const afterSO={customFields:[{id:775,isRequired:true,value:'keep'},{id:820,value:'556'}]};
const planned=[{lineId:1,replacement:{desiredItemName:'Part',desiredItemNumber:'ABC',desiredPrice:10,desiredQty:2,newItemId:9003}}];
const verify=(a=afterSO,lines=[afterLine],b=beforeSO)=>c.enp_verifySalesOrderReplacement_(b,[beforeLine],a,lines,{1:9003},planned);
test('readback requires CF820 and required fields to survive',()=>{
 verify();
 assert.throws(()=>verify({...afterSO,customFields:[{id:775,isRequired:true,value:'keep'}]}),/CF820/);
 assert.throws(()=>verify({...afterSO,customFields:[{id:820,value:'556'}]}),/required SO Custom Field 775/);
 assert.throws(()=>verify({...afterSO,customFields:[{id:775,isRequired:true,value:'changed'},{id:820,value:'556'}]}),/changed/);
});
test('readback rejects missing lines and wrong replacement Item ID',()=>{
 assert.throws(()=>verify(afterSO,[]),/line count/);
 assert.throws(()=>verify(afterSO,[{...afterLine,item:{id:9004}}]),/expected ItemId/);
});
test('source configuration retains bounded ActionHub retries and test-mode rep alerts',()=>{
 const cfg=vm.runInContext('ENP',c);assert.equal(cfg.HUB.RUNNER_MAX_ATTEMPTS,6);assert.equal(cfg.HUB.RUNNER_BATCH_SIZE,25);assert.equal(cfg.EMAIL.INVALID_DESC_ALERT_TEST_MODE,true);
});
test('gap reproduced: blank creation cost falls back to zero',()=>{
 const p=c.enp_buildItemPayloadFromSheetRow_(['Item Number: ABC\nItem Name: Part\nPrice: $10'],{ItemDescription:0});
 assert.equal(p.Cost,0);findings.push('Item payload builder defaults absent cost to 0; Hub supplier cost/approval is not consumed.');
});
test('gap reproduced: target quantity/price are not readback acceptance checks',()=>{
 verify(afterSO,[{...afterLine,qty:999,price:999}]);
 findings.push('Replacement verifier accepts wrong target Qty/Price when Item ID, description and required fields are correct.');
});
test('conditional gap reproduced: CF820 required flag conflicts with expected update',()=>{
 assert.throws(()=>verify(afterSO,[afterLine],{customFields:[{id:775,isRequired:true,value:'keep'},{id:820,isRequired:true,value:'old'}]}),/required SO Custom Field 820 changed/);
 findings.push('If CF820 is marked required, generic unchanged-required-field verification conflicts with the intentional CF820 update. Live required flag not checked.');
});
assert.equal(networkAttempts,0);
console.log(JSON.stringify({checks,externalNetworkAttempts:networkAttempts,activeFiles:files.length,duplicates,findings,files:fileResults},null,2));
