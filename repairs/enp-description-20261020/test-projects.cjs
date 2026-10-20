// JavaScript / Node.js — tests actual assembled Apps Script files without network.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const dir=process.argv[2],hubFile=process.argv[3];if(!dir||!hubFile)throw Error('Expected complete ENP source directory and Hub source file');
let network=0;const context=()=>vm.createContext({Logger:{log(){}},console:{log(){}},UrlFetchApp:{fetch(){network++;throw Error('Network forbidden')}}});
const enp=context();for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.js')).sort())vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),enp,{filename:file});
let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name)};
test('operational parser preserves empty fields and reads full thousands-space price',()=>{
 assert.equal(enp.enp_parseDescription_('Item Number:\nItem Name: Ortal Tunnel\nPrice: $26,830').itemNumber,'');
 assert.equal(enp.enp_parseDescription_('Item Number: IFM-SPAN-IFM24\nItem Name:\nPrice:').name,'');
 assert.equal(enp.enp_parseDescription_('Item Number: ABC\nItem Name: Part\nPrice: $17 399.00').price,17399);
});
test('operational strict guard permits complete multiline names but rejects missing or malformed fields',()=>{
 assert(enp.enp_guardIsStandardDescription_('Item Number: PVW47\nItem Name: FLUSH WALL MOUNT\nPOWER VENT KIT\nPrice: 1119'));
 assert(enp.enp_guardIsStandardDescription_('Item Number: ABC\nItem Name: Part\nPrice: $17 399.00'));
 for(const raw of ['Item Number:\nItem Name: Part\nPrice: 3','Item Number: ABC\nItem Name:\nPrice: 3','Item Number: ABC\nItem Name: Part\nPrice: $17 39.00','ABC\nPart\n$3','Item Name: Part\nItem Number: ABC\nPrice: $3'])assert(!enp.enp_guardIsStandardDescription_(raw));
});
test('canonical guard rejects label/prose identities and corrupt catalog names',()=>{
 assert.throws(()=>enp.enp_guardCanonicalName_('Price:','ABC'),/Valid Item/);
 assert.throws(()=>enp.enp_guardCanonicalName_('Matchlit','Paloform Fold 48 powder coated aluminium and corten'),/Valid Item/);
 assert.equal(enp.enp_guardCanonicalName_('Part (ABC)','ABC'),'Part (ABC)');
});
const hub=context();vm.runInContext(fs.readFileSync(hubFile,'utf8'),hub,{filename:hubFile});
test('Hub embedded parser and classifier keep identity/price safeguards',()=>{
 assert.equal(hub.hub_descParseFields_('Item Number: ABC\nItem Name: Part\nPrice: $17 399.00').price,17399);
 const r=hub.hub_enpClassifyRecord_({row:2,raw:'Item Number: ABC\nItem Name: Part\nPrice: $244',soPrice:600},[]);
 assert.equal(r.price,244);assert(r.issues.includes('ORDER_PRICE_DIFFERS'));
 const m=hub.hub_enpClassifyRecord_({row:2,raw:'BDM VENTING\n- Pipe\n- Elbow\n- Shipping',soPrice:800},[]);assert.equal(m.price,null);
});
if(process.argv[4])test('all actual Hub rows produce identical CJS and embedded Hub results',()=>{
 const data=JSON.parse(fs.readFileSync(process.argv[4],'utf8')),c=require('./classify.cjs');
 const catalog=[...data.master,...data.hub];for(const row of data.rows)assert.deepEqual(JSON.parse(JSON.stringify(hub.hub_enpClassifyRecord_(row,catalog))),c.classifyRecord(row,catalog));
});
assert.equal(network,0);console.log(JSON.stringify({checks,externalNetworkAttempts:network}));
