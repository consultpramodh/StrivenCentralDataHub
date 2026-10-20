// JavaScript / Node.js — read-only tests of a supplied live source snapshot.
// Usage: node test_rules.cjs /absolute/path/to/SNAPSHOT/ENP/src
// All IDs in test fixtures are synthetic. No Apps Script function may call a network.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const dir=process.argv[2];if(!dir)throw Error('Supply full snapshot source directory with patched files overlaid');
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
test('blank creation cost remains unknown',()=>{
 const p=c.enp_buildItemPayloadFromSheetRow_(['Item Number: ABC\nItem Name: Part\nPrice: $10'],{ItemDescription:0});
 assert.equal(p.Cost,null);
});
test('readback rejects incorrect or missing target quantity and price',()=>{
 for (const bad of [{qty:999},{price:999},{qty:null},{price:null},{price:''},{price:false}]) assert.throws(()=>verify(afterSO,[{...afterLine,...bad}]),/quantity|price/);
 verify(afterSO,[{...afterLine,qty:'2',price:'10'}]);
});
test('required CF820 may change only to expected value',()=>{
 const b={customFields:[{id:775,isRequired:true,value:'keep'},{id:820,isRequired:true,value:'old'}]};
 verify(afterSO,[afterLine],b);
 assert.throws(()=>verify({...afterSO,customFields:[...afterSO.customFields,{id:820,value:'556'}]},[afterLine],b),/CF820/);
 assert.throws(()=>verify({...afterSO,customFields:[{id:775,value:'keep'},{id:820,value:'wrong'}]},[afterLine],b),/CF820/);
});
test('nonrequired field loss, change and selected-option changes are rejected',()=>{
 const b={customFields:[...beforeSO.customFields,{id:831,isRequired:false,valueNumber:0,booleanValue:false,selectedOptions:[{id:9}]}]};
 const good={customFields:[...afterSO.customFields,{id:831,isRequired:false,valueNumber:0,booleanValue:false,selectedOptions:[{id:9}]}]};
 verify(good,[afterLine],b);
 assert.throws(()=>verify(afterSO,[afterLine],b),/Custom Field 831/);
 assert.throws(()=>verify({...good,customFields:[...afterSO.customFields,{id:831,isRequired:false,valueNumber:0,booleanValue:false,selectedOptions:[{id:10}]}]},[afterLine],b),/Custom Field 831 changed/);
});
const row={'Create Authorized':true,'Workflow Status':'READY',Source:'Approved','Item Number':'ABC','Item Name':'Part (ABC)',Price:10,Cost:0,'Item Category':'Parts','Preferred Vendor':'Supplier',Manufacturer:'Maker','Manufacturer Part#':'ABC','Serial Number Tracking':'NO','Location Name':'60 - WAREHOUSE (Ajax)',Taxable:'Yes','Item Type':'Inventory',UPC:'00123','MAP Price':'',Currency:'CAD','Quoted Authorization':false};
const refs={BaseCurrency:'CAD'};
for (const [field,name,id] of [['ItemType','Inventory',9001],['DefaultInventoryLocation','60 - WAREHOUSE (Ajax)',9002],['Category','Parts',9003],['PreferredVendor','Supplier',9004],['Manufacturer','Maker',9005]]) refs[field]=[{Id:id,Name:name,Verified:true,Evidence:'synthetic test fixture'}];
const base={ItemNumber:'ABC',Name:'Part',IncomeGLAccount:{Id:9010}};
const candidate=(changes={},registry=refs)=>c.enp_guardHubPayloadFromRecord_(base,{...row,...changes},registry);
test('Hub candidate maps exact API fields and preserves zero, UPC and GL defaults',()=>{
 const out=plain(candidate());assert.equal(out.payload.Name,'Part (ABC)');assert.equal(out.payload.Cost,0);assert.equal(out.payload.Category.Id,9003);assert.equal(out.payload.PreferredVendor.Id,9004);assert.equal(out.payload.Manufacturer.Id,9005);assert.equal(out.payload.ManufacturePartNumber,'ABC');assert.equal(out.payload.BarcodeValue,'00123');assert.equal(out.payload.IncomeGLAccount.Id,9010);
 assert.deepEqual(out.unsupportedFields,['Serial Number Tracking']);assert.equal(out.serialTracking,'NO');
 assert.deepEqual(plain(candidate({'MAP Price':0})).unsupportedFields,['Serial Number Tracking','MAP Price']);
});
test('Hub authorization and Quoted gates require booleans',()=>{
 for(const value of [false,'TRUE',1,'']) assert.throws(()=>candidate({'Create Authorized':value}),/Create Authorized/);
 assert.throws(()=>candidate({Source:'Quoted','Quoted Authorization':'TRUE'}),/Quoted Authorization/);
 candidate({Source:'Quoted','Quoted Authorization':true});
 assert.throws(()=>candidate({'Workflow Status':'NEEDS REVIEW'}),/Workflow Status/);
});
test('Hub rejects missing/negative cost, identity drift, currency and changed constants',()=>{
 for(const Cost of ['',null,-1,'bad',false]) assert.throws(()=>candidate({Cost}),/Price and Cost/);
 for(const change of [{'Item Number':'DEF'},{'Item Name':'Wrong'},{Currency:''},{Currency:'USD'},{Taxable:'No'},{'Location Name':'Other'},{UPC:123}]) assert.throws(()=>candidate(change),/HUB_METADATA_BLOCKED/);
});
test('reference IDs require exact unique verified evidence',()=>{
 assert.throws(()=>candidate({},{}),/currency/);
 assert.throws(()=>candidate({},{...refs,Category:[...refs.Category,...refs.Category]}),/ambiguous/);
 assert.throws(()=>candidate({},{...refs,Category:[{Id:9003,Name:'Parts',Verified:false,Evidence:'x'}]}),/unverified/);
 assert.throws(()=>candidate({},{...refs,Category:[{Id:9003,Name:'Parts',Verified:true}]}),/unverified/);
});
const headers=Object.keys(row),grid=[headers,headers.map(h=>row[h])];
test('Hub maps by header regardless of column order and rejects duplicate/missing headers',()=>{
 const shuffled=[...headers].reverse();assert.equal(c.enp_guardHubRecords_([shuffled,shuffled.map(h=>row[h])])[0].Cost,0);
 assert.throws(()=>c.enp_guardHubRecords_([headers.concat('Cost')]),/duplicate header/);
 assert.throws(()=>c.enp_guardHubRecords_([headers.filter(h=>h!=='Cost')]),/missing header Cost/);
});
test('production adapter blocks unsupported serial path and ambiguous source rows',()=>{
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>grid})})});
 c.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify(refs)})};
 assert.throws(()=>c.enp_guardBuildHubCreatePayload_(base),/Serial Number Tracking/);
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>[...grid,grid[1]]})})});
 assert.throws(()=>c.enp_guardBuildHubCreatePayload_(base),/multiple Hub rows/);
});
test('existing verified item reuse does not require Hub creation approval',()=>{
 const resolve=c.enp_guardResolveExistingItem_;c.enp_guardResolveExistingItem_=()=>({Id:9990});
 const result=c.enp_guardCreateOrResolveItem_(base);assert.equal(result.id,9990);assert.equal(result.status,'EXISTS');
 c.enp_guardResolveExistingItem_=resolve;
});
test('missing Hub approval cannot reach item POST',()=>{
 c.enp_guardResolveExistingItem_=()=>null;
 const badgrid=[headers,headers.map(h=>({...row,'Create Authorized':false})[h])];
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>badgrid})})});
 let posts=0;c.enp_guardRawRequest_=()=>{posts++;throw Error('unexpected POST')};
 assert.throws(()=>c.enp_guardCreateOrResolveItem_(base),/Create Authorized/);assert.equal(posts,0);
});
test('duplicate outgoing CF820 is rejected before posting',()=>{
 assert.throws(()=>c.enp_applyCf820ToReplacementPayload_({CustomFields:[{Id:820},{Id:820}]}),/duplicate/);
});
test('manual builder preserves missing cost as unknown and explicit zero',()=>{
 const props=c.PropertiesService;c.PropertiesService=makeContext().PropertiesService;
 const cols={itemNumber:0,itemName:1,price:2,cost:3};
 assert.equal(c.manualBuildItemPayloadFromRow_(['ABC','Part',10,''],cols).Cost,null);
 assert.equal(c.manualBuildItemPayloadFromRow_(['ABC','Part',10,0],cols).Cost,0);
 c.PropertiesService=props;
});
if(process.argv[3])test('live Hub preview makes no writes and no Striven calls',()=>{
 const livegrid=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>livegrid})})});
 c.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};
 const preview=c.enp_previewHubItemCreation();assert.equal(preview.ready,0);assert.equal(preview.writes,0);assert.equal(preview.strivenCalls,0);
 console.log('LIVE_HUB_PREVIEW '+JSON.stringify({rows:preview.rows,ready:preview.ready,blocked:preview.results.filter(r=>r.status==='BLOCKED').length}));
});
assert.equal(networkAttempts,0);
console.log(JSON.stringify({checks,externalNetworkAttempts:networkAttempts,activeFiles:files.length,duplicates,findings,files:fileResults},null,2));
