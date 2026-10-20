// Node.js: full legacy project with API-free boundary tests.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const dir=process.argv[2];let checks=0,network=0;
function ctx(){const c=vm.createContext({Logger:{log(){}},console,UrlFetchApp:{fetch(){network++;throw Error('Network forbidden');}},PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}});
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.js')).sort())vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),c,{filename:f});
const bundle=c.hub_row2LegacyEngine_.toString();vm.runInContext(bundle.slice(bundle.indexOf('{')+1,bundle.lastIndexOf('\nreturn {')),c);return c;}
const c=ctx();function test(n,fn){fn();checks++;console.log('PASS '+n);}
const row={'Create Authorized':true,'Item Number':'G190-0004-SER','Item Name':'THERMOSTAT (G190-0004-SER)',Price:3,Cost:1.8,'Item Category':'Hearth - Parts',Description:'THERMOSTAT (G190-0004-SER)','Preferred Vendor':'Wolf Steel Ltd.',Manufacturer:'Wolf Steel Ltd.','Manufacturer Part#':'G190-0004-SER','Serial Number Tracking':'NO','Location Name':'60 - WAREHOUSE (Ajax)',Taxable:'Yes','Item Type':'Inventory',UPC:'','MAP Price':'',Currency:'CAD',Source:'Approved','Sales Order Number':586037,'SO Internal ID':27771,'SO Status':'Approved',Quantity:2,'SO Line Price':3,'Striven Item ID':'','Quoted Authorization':'','Workflow Status':'LOOKUP PENDING','Review Reason':'',Discount:0.4,'Original Description':'Item Number: G190-0004-SER\nItem Name: THERMOSTAT\nPrice: $3.00'};
const desc='Item Number: G190-0004-SER\nItem Name: THERMOSTAT\nPrice: $3.00';
const source={SalesOrderSalesOrderId:27771,ItemItemId:36935,ItemNumber:'ENTERNEWPART',ItemDescription:desc,Quantity:2,Price:3,NewItemId:'',NewItemNumber:'',NewItemName:'',NewItemPrice:'',NewItemCost:'',LastAction:'',LastError:'',LastUpdated:''};
function grid(r){const h=Object.keys(r);return [h,h.map(k=>r[k])];}
function plan(change={},schange={}){return c.enp_legacyHubRow2Plan_(grid({...row,...change}),grid({...source,...schange}));}
test('reviewed row maps exactly and derives basename without doubled suffix',()=>{const p=plan();assert.equal(p.soId,27771);assert.equal(p.baseName,'THERMOSTAT');assert.equal(p.price,3);assert.equal(p.cost,1.8);assert.equal(p.quantity,2);});
test('authorization and pinned business scope reject changes',()=>{for(const change of [{'Create Authorized':false},{'Create Authorized':'TRUE'},{'SO Internal ID':7},{'Sales Order Number':8},{'Item Number':'OTHER'},{Currency:'USD'},{Price:4},{Cost:0},{Quantity:3},{Source:'Quoted'},{'Item Name':'Wrong (G190-0004-SER)'}])assert.throws(()=>plan(change));});
test('legacy source identity, price, missing and duplicate candidates reject',()=>{for(const change of [{Price:4},{ItemDescription:'G190-0004-SER THERMOSTAT $3'},{ItemDescription:desc.replace('THERMOSTAT','OTHER')},{Quantity:3}])assert.throws(()=>plan({},change));const g=grid(source);assert.throws(()=>c.enp_legacyHubRow2Plan_(grid(row),[...g,g[1]]),/exactly one/);});
test('search envelopes accept only explicit arrays or proved zero',()=>{for(const b of [[],{data:[],totalCount:0},{Data:null,TotalCount:0},{data:[{id:1}],totalCount:1}])assert(Array.isArray(c.enp_legacySearchPage_(b).rows));for(const b of [null,{}, {data:null,totalCount:1},{data:[],rows:[]},{data:[],totalCount:false},{data:[],totalCount:-1},{data:[{}],totalCount:0},{data:[],totalCount:1,TotalCount:2}])assert.throws(()=>c.enp_legacySearchPage_(b));});
test('serial NO policy is scoped and does not suppress MAP or YES review',()=>{const refs={BaseCurrency:'CAD',LegacyUntrackedItemNumbers:['G190-0004-SER']};for(const [field,name,id] of [['ItemType','Inventory',901],['DefaultInventoryLocation',row['Location Name'],902],['Category',row['Item Category'],903],['PreferredVendor',row['Preferred Vendor'],904],['Manufacturer',row.Manufacturer,905]])refs[field]=[{Id:id,Name:name,Verified:true,Evidence:'synthetic live witness'}];const base={ItemNumber:row['Item Number'],Name:row['Item Name']};const r={...row,'Workflow Status':'READY'};
assert.equal(c.enp_guardHubPayloadFromRecord_(base,r,refs).unsupportedFields.length,0);
assert(c.enp_guardHubPayloadFromRecord_(base,{...r,'Serial Number Tracking':'YES'},refs).unsupportedFields.includes('Serial Number Tracking'));
assert(c.enp_guardHubPayloadFromRecord_(base,{...r,'MAP Price':0},refs).unsupportedFields.includes('MAP Price'));
assert(c.enp_guardHubPayloadFromRecord_(base,r,{...refs,LegacyUntrackedItemNumbers:[]}).unsupportedFields.includes('Serial Number Tracking'));
});
function run(opts={}){const x=ctx(),events=[],p=plan(),hub={getDataRange:()=>({getValues:()=>grid(row)}),getRange:()=>({setValue:v=>events.push(['hubID',v])})},src={getDataRange:()=>({getValues:()=>grid(source)})};
x.LockService={getUserLock:()=>({waitLock(){},releaseLock(){events.push(['unlock']);}})};
x.SpreadsheetApp={getActive:()=>({getSheetByName:()=>src})};// Use original project configuration.
x.enp_guardHubBook_=()=>({getSheetByName:()=>hub});x.enp_legacyHubRow2Plan_=()=>p;
x.enp_getSalesOrder_=()=>({orderNumber:586037,status:{name:opts.badStatus?'Quoted':'Approved'},lineItems:[]});
x.enp_legacyExactLookupNow_=()=>{events.push(['lookup']);return opts.existing?{Id:9901}:null};
x.enp_findTargetPlaceholderLine_=()=>({id:8801,qty:opts.badQty?9:2,price:3});
x.enp_buildItemPayloadFromSheetRow_=()=>({ItemNumber:row['Item Number'],Name:'THERMOSTAT',Cost:1.8,Price:3});
x.enp_legacyHydrateReferences_=()=>events.push(['references']);x.enp_legacyAssertHubRow2Unchanged_=()=>{};
x.enp_legacyWriteHubStatus_=(_,s)=>events.push(['status',s]);
x.enp_guardCreateOrResolveItem_=()=>{events.push(['resolve']);return {status:opts.existing?'EXISTS':'CREATED',id:9901}};
x.enp_legacySaveSourceResolution_=()=>events.push(['saveID',9901]);
x.enp_legacyLiveItem_=()=>({Id:9901,ItemNumber:row['Item Number'],Name:row['Item Name'],Price:3,Cost:1.8});
x.enp_replaceSalesOrderItems_=(id,reps)=>{events.push(['replace',id,reps]);if(opts.replaceFail)throw Error('replacement failure');return {replacements:[{lineId:8801}]}};
x.enp_legacySaveSourceAction_=(_,__,a)=>events.push(['sourceAction',a]);
let result,error;try{result=x.enp_runHubRow2CreateAndReplace()}catch(e){error=e}return {events,result,error};}
test('create route saves ID before replacement and uses existing engine',()=>{const r=run();if(r.error)throw r.error;assert.equal(r.result.status,'COMPLETED');const e=r.events;assert(e.findIndex(a=>a[0]==='saveID')<e.findIndex(a=>a[0]==='replace'));const rep=e.find(a=>a[0]==='replace');assert.equal(rep[1],27771);assert.equal(rep[2][0].desiredQty,2);assert.equal(rep[2][0].desiredPrice,3);assert.equal(rep[2][0].desiredItemName,'THERMOSTAT');assert(e.some(a=>a[0]==='references'));});
test('reuse route skips create metadata resolution',()=>{const r=run({existing:true});if(r.error)throw r.error;assert.equal(r.result.itemResolution,'EXISTS');assert(!r.events.some(a=>a[0]==='references'));});
test('live order status or quantity changes stop before resolution and replacement',()=>{for(const opts of [{badStatus:true},{badQty:true}]){const r=run(opts);assert(r.error);assert(!r.events.some(a=>a[0]==='resolve'||a[0]==='replace'));assert.equal(r.events.at(-1)[0],'unlock');}});
test('replacement failure retains captured item ID and retry status',()=>{const r=run({replaceFail:true});assert(r.error);assert(r.events.some(a=>a[0]==='saveID'));assert(r.events.some(a=>a[0]==='status'&&a[1]==='ITEM READY — REPLACEMENT BLOCKED'));assert.equal(r.events.at(-1)[0],'unlock');});

test('native plan uses Hub original description and SO line price',()=>{
 const p=c.enp_hubNativePlan_(grid(row));assert.equal(p.soId,27771);assert.equal(p.sourceRowNumber,2);
 assert.throws(()=>c.enp_hubNativePlan_(grid({...row,'Original Description':'wrong'})));
 assert.throws(()=>c.enp_hubNativePlan_(grid({...row,'SO Line Price':4})));
});
test('native preview reads only Hub and makes no writes or network calls',()=>{
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>grid(row)})})});
 const p=c.enp_previewHubRow2CreateAndReplace();assert.equal(p.status,'PREVIEW');assert.equal(p.strivenCalls,0);assert.equal(p.strivenWrites,0);
});
test('native builder defers type resolution and never invents IDs',()=>{
 const p=c.enp_hubNativePlan_(grid(row)),s=p.sourceRow,co=p.sourceCol;s[co.NewItemNumber]=row['Item Number'];s[co.NewItemName]='THERMOSTAT';s[co.NewItemPrice]=3;s[co.NewItemCost]=1.8;
 const b=c.enp_buildItemPayloadFromSheetRow_(s,co);assert(!b.ItemType);assert.equal(b.Cost,1.8);assert.equal(b.Name,'THERMOSTAT');
});
test('native auth uses Hub token manager and rejects missing credentials',()=>{
 c.PropertiesService={getScriptProperties:()=>({getProperty:k=>({CLIENT_ID:'synthetic-id',CLIENT_SECRET:'synthetic-secret'})[k]||null})};
 c.hub_strivenAccessToken_=(id,secret)=>{assert.equal(id,'synthetic-id');assert.equal(secret,'synthetic-secret');return {accessToken:'synthetic-token'};};
 assert.equal(c.enp_guardHeaders_().Authorization,'Bearer synthetic-token');
 c.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};assert.throws(()=>c.enp_guardHeaders_(),/credentials missing/);
});
test('watchdog schedules a global Hub handler',()=>{
 let handler;c.ScriptApp={getProjectTriggers:()=>[],newTrigger:n=>{handler=n;return {timeBased(){return this},after(){return this},create(){return this}}}};
 c.enp_scheduleItemGroupBridgeWatchdog_();assert.equal(handler,'hub_recoverItemGroupMasterBridgeWatchdog');assert.equal(typeof c[handler],'function');
});
assert.equal(network,0);console.log(JSON.stringify({checks,externalNetworkAttempts:network}));
