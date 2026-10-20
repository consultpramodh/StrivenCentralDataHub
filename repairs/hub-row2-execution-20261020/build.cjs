// Node.js — create a namespaced Hub bundle from verified live legacy declarations.
const fs=require('fs'),path=require('path'),acorn=require('acorn'),walk=require('acorn-walk'),scope=require('eslint-scope'),assert=require('assert'),vm=require('vm');
const [legacyDir,hubFile,overridesFile,outFile]=process.argv.slice(2),defs=new Map(),origins={};
function ingest(source,file,override=false){
 const ast=acorn.parse(source,{ecmaVersion:2022,ranges:true});
 for(const node of ast.body){
  if(node.type==='FunctionDeclaration'){defs.set(node.id.name,{code:source.slice(node.start,node.end),node});origins[node.id.name]=file;}
  else if(node.type==='VariableDeclaration')for(const d of node.declarations)if(d.id.type==='Identifier'){
   const code=node.kind+' '+source.slice(d.start,d.end)+';';
   defs.set(d.id.name,{code,node:acorn.parse(code,{ecmaVersion:2022,ranges:true})});origins[d.id.name]=file;
  }
 }
}
for(const f of fs.readdirSync(legacyDir).filter(f=>f.endsWith('.js')).sort())ingest(fs.readFileSync(path.join(legacyDir,f),'utf8'),f);
ingest(fs.readFileSync(overridesFile,'utf8'),'hub-native-overrides.js',true);
const hydrate=defs.get('enp_legacyHydrateReferences_');assert(hydrate);
hydrate.code=hydrate.code.replace("if(Number(base.ItemType&&base.ItemType.Id)!==enp_guardHubReference_(registry,'ItemType','Inventory').Id)","if(base.ItemType && Number(base.ItemType.Id)!==enp_guardHubReference_(registry,'ItemType','Inventory').Id)");
hydrate.code=hydrate.code.replace("registry.BaseCurrency='CAD';","base.ItemType=enp_guardHubReference_(registry,'ItemType','Inventory');\n  registry.BaseCurrency='CAD';");
hydrate.node=acorn.parse(hydrate.code,{ecmaVersion:2022,ranges:true});
const watchdog=defs.get('enp_scheduleItemGroupBridgeWatchdog_');assert(watchdog);watchdog.code=watchdog.code.replace("'enp_recoverItemGroupMasterBridgeWatchdog'","'hub_recoverItemGroupMasterBridgeWatchdog'");
watchdog.node=acorn.parse(watchdog.code,{ecmaVersion:2022,ranges:true});
const chosen=new Set(),queue=['enp_runHubRow2CreateAndReplace','enp_previewHubRow2CreateAndReplace','enp_recoverItemGroupMasterBridgeWatchdog'];
while(queue.length){const name=queue.shift();if(chosen.has(name))continue;const d=defs.get(name);assert(d,'Missing declaration '+name);chosen.add(name);
 walk.full(d.node,node=>{if(node.type==='Identifier'&&defs.has(node.name)&&!chosen.has(node.name))queue.push(node.name);});
}
const chunks=[...chosen].map(name=>defs.get(name).code),exports=[...chosen].filter(n=>defs.get(n).code.startsWith('function '));
let body=chunks.join('\n\n');
const constants=[...chosen].filter(n=>!exports.includes(n));
for(const name of constants){
 const d=defs.get(name);
 walk.full(d.node,node=>{if(node.type==='CallExpression'){const z=node.callee;assert(z.type==='MemberExpression'&&z.object.name==='Object'&&z.property.name==='freeze','Non-static initializer '+name);}assert(!['NewExpression','AwaitExpression','AssignmentExpression'].includes(node.type),'Impure initializer '+name);});
}
const factory='function hub_row2LegacyEngine_() {\n'+body+'\nreturn {'+exports.join(',')+',ENP};\n}\n';
const ast=acorn.parse(factory,{ecmaVersion:2022,ranges:true}),analysis=scope.analyze(ast,{ecmaVersion:2022,optimistic:true,ignoreEval:true});
const external=[...new Set(analysis.globalScope.through.map(r=>r.identifier.name))].sort();
const allow=new Set(['Array','Boolean','Date','Error','JSON','LockService','Logger','Map','Math','Number','Object','PropertiesService','RegExp','ScriptApp','Set','SpreadsheetApp','String','UrlFetchApp','Utilities','console','isFinite','isNaN','parseFloat','parseInt','undefined','hub_strivenAccessToken_']);
assert.deepEqual(external.filter(n=>!allow.has(n)),[],'Undefined external helpers');
let hub=fs.readFileSync(hubFile,'utf8');assert(!hub.includes('function hub_row2LegacyEngine_'),'already bundled');
assert(hub.includes(".addItem('Process Shared Item Lookups','hub_processItemLookups')"));
hub=hub.replace(".addItem('Process Shared Item Lookups','hub_processItemLookups')",
".addItem('Preview ENTERNEWPART row 2','hub_previewRow2CreateAndReplace')\n    .addItem('Create/reuse + replace ENTERNEWPART row 2','enp_runHubRow2CreateAndReplace')\n    .addSeparator()\n    .addItem('Process Shared Item Lookups','hub_processItemLookups')");
hub+='\n/* Google Apps Script — Central Hub native legacy execution; row 2 only. */\n'+
"function enp_runHubRow2CreateAndReplace() { return hub_row2LegacyEngine_().enp_runHubRow2CreateAndReplace(); }\n"+
"function hub_previewRow2CreateAndReplace() { return hub_row2LegacyEngine_().enp_previewHubRow2CreateAndReplace(); }\n"+
"function hub_recoverItemGroupMasterBridgeWatchdog() { return hub_row2LegacyEngine_().enp_recoverItemGroupMasterBridgeWatchdog(); }\n"+factory;
new vm.Script(hub);fs.writeFileSync(outFile,hub);
fs.writeFileSync(outFile+'.receipt.json',JSON.stringify({declarations:[...chosen],external,origins:Object.fromEntries([...chosen].map(n=>[n,origins[n]])),bytes:hub.length},null,2));
console.log('Hub native bundle: '+chosen.size+' dependency declarations; no unresolved helpers; '+hub.length+' bytes');
