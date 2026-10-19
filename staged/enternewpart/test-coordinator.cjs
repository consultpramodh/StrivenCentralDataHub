// JavaScript — offline integration checks using captured source rows.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
function syntheticFixture(){
 const headers=['Create Authorized','Item Number','Item Name','Price','Cost','Item Category','Description','Preferred Vendor','Manufacturer','Manufacturer Part#','Serial Number Tracking','Location Name','Taxable','Item Type','UPC','MAP Price','Currency','Source','Sales Order Number','SO Internal ID','SO Status','Quantity','SO Line Price','Striven Item ID','Quoted Authorization','Workflow Status','Review Reason','Research URL','Cost Basis','Discount','Source Item Price','Original Description','Original Action','Original Error','Source Row','Last Source Update','Hub Match Status','','Vendor Name (reference)','Manufacturer (reference)','Preferred Vendor (reference)','Discount','','Item Category (reference)','Serial Tracking'];
 const soHeaders=['SalesOrderSalesOrderId','ItemNumber','ItemDescription','Quantity','Price','SalesOrderNumber','SalesOrderStatus','NewItemNumber','NewItemName','NewItemPrice','NewItemId','LastAction','LastError','LastUpdated'];
 const manualHeaders=['Item Number','Item Name','Price','Striven Item Id','Status','Error','Created At'];
 const fixture={hub:[headers],approved:[soHeaders],quoted:[soHeaders],manual:[manualHeaders]};
 for(let i=0;i<65;i++){
   const kind=i===0?'Approved':i<61?'Quoted':'Manual',j=i===0?0:i<61?i-1:i-61,sku='TEST-'+i,desc='Item Number: '+sku+'\nItem Name: Test part '+i+'\nPrice: $100.00';
   const obj={'Create Authorized':false,'Item Number':sku,'Item Name':'Test part '+i,Price:100,Source:kind,'SO Internal ID':kind==='Manual'?'':i+100,Quantity:kind==='Manual'?'':1,'Original Description':kind==='Manual'?'':desc,'Source Row':j+2,'Workflow Status':'NEEDS REVIEW'};
   fixture.hub.push(headers.map(h=>obj[h]??''));
   if(kind==='Manual')fixture.manual.push([sku,obj['Item Name'],100,'','','','']);
   else fixture[kind==='Approved'?'approved':'quoted'].push([i+100,'ENTERNEWPART',desc,1,100,i+1000,kind,'','','','','','','']);
 }
 return fixture;
}
const f=process.env.ENP_TEST_FIXTURE?JSON.parse(fs.readFileSync(process.env.ENP_TEST_FIXTURE,'utf8')):syntheticFixture();
class Sheet{
 constructor(name,grid){this.name=name;this.grid=grid.map(r=>r.slice());this.notes={};}
 getName(){return this.name;}
 getDataRange(){return {getValues:()=>this.grid.map(r=>r.slice())};}
 getLastRow(){return this.grid.length;}
 getRange(r,c,n=1,m=1){return {setValue:v=>{while(this.grid.length<r)this.grid.push([]);this.grid[r-1][c-1]=v;},setNote:v=>{this.notes[r+':'+c]=v;},setValues:vs=>{vs.forEach((row,i)=>{while(this.grid.length<r+i)this.grid.push([]);row.forEach((v,j)=>this.grid[r+i-1][c+j-1]=v);});},getValues:()=>this.grid.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+m))};}
}
const hub=new Sheet('ENTERNEWPART',f.hub);
const tabs={ENTERNEWPART:hub,DATA_ITEMS:new Sheet('DATA_ITEMS',[['ItemNumber','Id'],['AA1800',42806]]),REFRESH_CONTROL:new Sheet('REFRESH_CONTROL',[['Dataset Key','Last Success'],['ITEMS',new Date()]])};
const source={Enternewpart:new Sheet('Enternewpart',f.approved),Enternewpart_Quoted:new Sheet('Enternewpart_Quoted',f.quoted),'Manual ItemCreation':new Sheet('Manual ItemCreation',f.manual)};
const props={ENP_HUB_COORDINATOR_ENABLED:'true'};
let released=0;
const ctx=vm.createContext({console,Date,SpreadsheetApp:{openById:id=>({getSheetByName:n=>(id.startsWith('13OK')?tabs:source)[n]}),flush(){}},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v;}})}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'enp_hub_autonomy.js'),'utf8'),ctx);
assert.equal(ctx.enpHubTestCoordinator().status,'PASS');
const before=hub.grid.map(r=>r.slice());
let result=ctx.enpHubCoordinate_(false);
assert.equal(result.added,0);assert.equal(result.evaluated,65);assert.equal(result.itemsFresh,true);assert.equal(released,1);
const headers=hub.grid[0], c=Object.fromEntries(headers.map((h,i)=>[h,i]));
// Coordinator may change only its state/reason/manual-request fields.
for(let i=1;i<66;i++)for(let j=0;j<44;j++)if(![0,c['Workflow Status'],c['Review Reason']].includes(j))assert.equal(hub.grid[i][j]??'',before[i][j]??'');
// One checkbox request is consumed and records the evaluated state in a note.
hub.grid[2][0]=true;
result=ctx.enpHubCoordinate_(false);assert.equal(result.added,0);assert.equal(hub.grid[2][0],false);assert.match(hub.notes['3:1'],/Manual request evaluated/);
// A repeated tick does not append the same source rows.
assert.equal(ctx.enpHubCoordinate_(false).added,0);
// Pure routing: a missing catalog record cannot create anything.
assert.equal(ctx.enpHubPlan_({Source:'Manual','Create Authorized':true,'Item Number':'UNKNOWN','Item Name':'Unknown'}, {},true).state,'RESEARCH REQUIRED');
console.log('PASS: 65-row integration, unchanged-field preservation, manual request consumption, repeated-run deduplication, 10 route/parser assertions. No network calls.');
