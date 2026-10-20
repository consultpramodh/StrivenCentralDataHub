// JavaScript / Node.js — classification never calls Striven or changes source text.
'use strict';
const p=require('./description-parser.cjs');
const aliases={
 '77L70':{sku:'SV4.5L6',name:'6" Length Rigid DV Vent',url:'https://ihp.us.com/wp-content/uploads/2021/09/901189-00_A_AST_ScorpioCD_35_40_45-C_DEN-DEP_DV_FP_ECO_IICO.pdf'},
 '77L75':{sku:'SV4.5LA',name:'Adjustable Length Slip Section (2" - 7.5") - rigid',url:'https://ihp.us.com/wp-content/uploads/2021/09/901189-00_A_AST_ScorpioCD_35_40_45-C_DEN-DEP_DV_FP_ECO_IICO.pdf'}
};
function classifyRecord(row,catalog) {
 const parsed=p.parseDescriptionFields(row.raw),issues=[],evidence=[],manual=!String(row.raw||'').trim();
 let sku=manual?String(row.sku||'').trim():parsed.itemNumber;
 let name=manual?String(row.name||'').trim():parsed.name;
 let price=manual?p.parseMoneyStrict(row.price):parsed.price;
 let numberStatus=sku?'SOURCE_VALUE':'MISSING',nameStatus=name?'SOURCE_VALUE':'MISSING',priceStatus=price!==null?'DESCRIPTION_PRICE':'MISSING';
 if(manual){priceStatus=price!==null?'MANUAL_VALUE':'MISSING';}
 if(!manual&&parsed.format==='UNLABELED')issues.push('NONSTANDARD_FORMAT');
 if(parsed.multiItem){return {row:row.row,itemNumber:'',itemName:'BDM VENTING — multiple components; split required',price:null,category:'MULTI_ITEM',numberStatus:'SPLIT_REQUIRED',nameStatus:'MULTI_COMPONENT_DESCRIPTION',priceStatus:'AGGREGATE_NOT_ALLOCATED',issues:['MULTI_ITEM_DESCRIPTION'],evidence:['Original Description contains multiple bullet components; SO line total is not an individual item price.'],original:row.raw};}
 if(!sku&&parsed.sourceItemNumber&&p.validItemName(parsed.sourceItemNumber)) name=parsed.sourceItemNumber+' — '+name;
 if(sku&&!p.validItemNumber(sku)){issues.push('INVALID_ITEM_NUMBER');sku='';numberStatus='INVALID';}
 if(name&&!p.validItemName(name)){issues.push('INVALID_ITEM_NAME');name='';nameStatus='INVALID';}
 if(parsed.issues.includes('INVALID_ITEM_NUMBER')){issues.push('INVALID_ITEM_NUMBER');numberStatus='INVALID';}
 if(parsed.issues.includes('INVALID_ITEM_NAME'))issues.push('INVALID_ITEM_NAME');
 for(const x of parsed.issues.filter(x=>/^DUPLICATE_|INVALID_PRICE|LABEL_STRUCTURE|UNEXPECTED_CONTINUATION/.test(x)))issues.push(x);
 // An explicitly documented manufacturer alias can reuse a known local model.
 const originalSku=sku,alias=aliases[sku.toUpperCase()];
 if(alias){sku=alias.sku;name=alias.name;numberStatus='VERIFIED_MANUFACTURER_ALIAS';nameStatus='VERIFIED_MANUFACTURER_ALIAS';evidence.push(alias.url+' — '+originalSku+' = '+sku);}
 // DUR is a vendor prefix in this supplied row, not the part number.
 if(!sku&&/^DUR\s+4BVK\s+/i.test(parsed.normalized)){
   sku='4BVK';name=parsed.normalized.replace(/^DUR\s+4BVK\s+/i,'').replace(/\s+/g,' ');numberStatus='MANUFACTURER_VERIFIED';nameStatus='SOURCE_VALUE';
   evidence.push('https://duravent.com/literature/DV_BVGV_CT-001E_04-24_web.pdf — 4BVK roof top termination kit');
 }
 const all=catalog.filter(r=>String(r.sku).trim().toUpperCase()===sku.toUpperCase()&&sku);
 const usable=all.filter(r=>p.validItemNumber(r.sku)&&(p.validItemName(r.name)||alias)&&Number(r.id)>0);
 const ids=[...new Set(usable.map(r=>Number(r.id)))];
 let exact=null;
 if(ids.length===1){exact=usable.find(r=>r.source==='masterInventory')||usable[0];sku=String(exact.sku).trim();if(numberStatus==='SOURCE_VALUE')numberStatus='EXACT_CATALOG_IDENTITY';evidence.push(exact.source+' row '+exact.sourceRow+'; Item ID '+exact.id);}
 else if(ids.length>1)issues.push('AMBIGUOUS_CATALOG_IDENTITY');
 else if(all.length){issues.push('CORRUPT_CATALOG_MATCH');evidence.push('Matching catalog row has invalid item number/name; not accepted as authoritative.');}
 else if(sku&&!['MANUFACTURER_VERIFIED'].includes(numberStatus))issues.push('NO_CATALOG_IDENTITY');
 if(exact&&!p.validItemName(exact.name))issues.push('CATALOG_NAME_REPAIR_REQUIRED');
 if(!name&&exact&&p.validItemName(exact.name)){name=String(exact.name).trim();nameStatus='EXACT_CATALOG_FILL';}
 if(!sku&&name){
   const normal=s=>String(s).trim().replace(/\s*\([^()]+\)\s*$/,'').replace(/\s+/g,' ').toUpperCase();
   const candidates=catalog.filter(r=>p.validItemNumber(r.sku)&&normal(r.name)===normal(name));
   const candidateIds=[...new Set(candidates.map(r=>r.id))];
   if(candidateIds.length){evidence.push('Name-only candidate(s), not auto-selected: '+[...new Set(candidates.map(r=>String(r.sku)+' / ID '+r.id))].join('; '));issues.push('NAME_ONLY_CANDIDATE_REQUIRES_CONTEXT');}
 }
 if(price===null&&typeof row.soPrice==='number'&&Number.isFinite(row.soPrice)&&row.soPrice>0){price=row.soPrice;priceStatus='SO_LINE_PRICE_FALLBACK';evidence.push('ENTERNEWPART!W'+row.row+' sales-order line price; not independently verified supplier list price.');}
 if(price===null&&exact&&typeof exact.price==='number'&&Number.isFinite(exact.price)&&exact.price>0){price=exact.price;priceStatus='EXACT_CATALOG_PRICE';evidence.push(exact.source+'!F'+exact.sourceRow+' existing item selling price; not supplier list cost input.');}
 if(price!==null&&typeof row.soPrice==='number'&&row.soPrice!==price)issues.push('ORDER_PRICE_DIFFERS');
 if(price!==null&&exact&&typeof exact.price==='number'&&exact.price!==price){issues.push('CATALOG_PRICE_DIFFERS');evidence.push('Catalog price '+exact.price+' differs from selected transaction/description price '+price+'.');}
 if(price===0)issues.push('ZERO_PRICE_REQUIRES_REVIEW');
 if(!sku)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
 const outName=p.canonicalItemName(name,sku);
 let category;
 if(!sku&&!name&&price===null)category='NO_ITEM_INFORMATION';
 else if(issues.some(x=>/^INVALID_|^CORRUPT_CATALOG|^DUPLICATE_|^LABEL_STRUCTURE|^UNEXPECTED_CONTINUATION/.test(x)))category='INCORRECT_INFORMATION';
 else if(issues.some(x=>/^MISSING_/.test(x)))category='PARTIAL_INFORMATION';
 else if(issues.some(x=>/DIFFERS|AMBIGUOUS|ZERO_PRICE/.test(x)))category='CONFLICTING_INFORMATION';
 else if(issues.some(x=>/NO_CATALOG|CATALOG_NAME/.test(x)))category='IDENTITY_REVIEW';
 else category=parsed.format==='UNLABELED'&&!manual?'FORMAT_RECOVERED':manual?'MANUAL_SOURCE':'STRUCTURED';
 return {row:row.row,itemNumber:sku,itemName:outName,price,category,numberStatus,nameStatus,priceStatus,issues:[...new Set(issues)],evidence,original:row.raw};
}
module.exports={classifyRecord,aliases};
if(require.main===module){const fs=require('fs'),data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const result=data.rows.map(r=>classifyRecord(r,[...data.master,...data.hub]));fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.filter((r,i)=>r.itemNumber!==String(data.rows[i].sku)||r.itemName!==data.rows[i].name||r.price!==(data.rows[i].price===''?null:data.rows[i].price)),null,2));}
