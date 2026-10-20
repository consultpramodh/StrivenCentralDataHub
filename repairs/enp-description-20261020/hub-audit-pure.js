// Google Apps Script — pure parser/classifier; no external API calls.
function hub_descNormalizeText_(text) {
  return String(text == null ? '' : text).replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/&#x([0-9a-f]+);/gi,(whole,x)=>{const n=parseInt(x,16);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&#(\d+);/g,(whole,x)=>{const n=Number(x);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'")
    .replace(/\r\n?/g,'\n').replace(/[\u00a0\u202f]/g,' ').trim();
}
function hub_descParseMoney_(text) {
  if (text == null || String(text).trim()==='') return null;
  let s=String(text).trim().replace(/[\u00a0\u202f]/g,' ');
  s=s.replace(/^(?:CAD|USD)[ \t]*/i,'').replace(/^\$[ \t]*/,'');
  if (!/^(?:\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?: \d{3})+(?:\.\d{1,2})?)$/.test(s)) return null;
  const n=Number(s.replace(/[, ]/g,''));
  return Number.isFinite(n)&&n>=0&&n<=9999999999998?n:null;
}
function hub_descValidNumber_(value) {
  const s=String(value||'').trim();
  return !!s && !/[\r\n]|(?:item\s*name|item\s*number|price)\s*:/i.test(s) &&
    s.split(/\s+/).length<5 && !/["<>]/.test(s) && s.toUpperCase()!=='ENTERNEWPART';
}
function hub_descValidName_(value) {
  const s=String(value||'').trim();
  return !!s && !/^(?:item\s*name|item\s*number|price)\s*:/i.test(s) && !/^NEEDSSKU\b/i.test(s);
}
function hub_descCanonicalName_(name,number) {
  let s=String(name||'').trim().replace(/\s+/g,' '),sku=String(number||'').trim();
  if (!s) return '';
  if (!sku) return s;
  const suffix=' ('+sku+')';
  while(s.toUpperCase().endsWith(suffix.toUpperCase()))s=s.slice(0,-suffix.length).trim();
  return s?s+suffix:'';
}
function hub_descParseFields_(text) {
  const raw=String(text==null?'':text),normalized=hub_descNormalizeText_(raw),issues=[];
  const lines=normalized.split('\n').map(s=>s.trim()).filter(Boolean);
  const labels=[],values={number:[],name:[],price:[]};let current=null;
  for(const line of lines){
    const m=line.match(/^(Item[ \t]*Number|Item[ \t]*Name|Price)[ \t]*:[ \t]*(.*)$/i);
    if(m){const key=/number/i.test(m[1])?'number':/name/i.test(m[1])?'name':'price';labels.push(key);current=key;values[key].push(m[2]);}
    else if(current==='name'&&values.name.length===1)values.name[0]+=(values.name[0]?' ':'')+line;
    else if(current)issues.push('UNEXPECTED_CONTINUATION');
  }
  let itemNumber='',name='',price=null,multiItem=false,format=labels.length?'LABELED':'UNLABELED';
  if(labels.length){
    for(const key of Object.keys(values))if(values[key].length>1)issues.push('DUPLICATE_'+key.toUpperCase()+'_LABEL');
    itemNumber=values.number.length===1?values.number[0].trim():'';
    name=values.name.length===1?values.name[0].trim():'';
    price=values.price.length===1?hub_descParseMoney_(values.price[0]):null;
    if(labels.join(',')!=='number,name,price')issues.push('LABEL_STRUCTURE');
    if(values.price[0]&&price===null)issues.push('INVALID_PRICE');
  }else if(normalized){
    multiItem=lines.filter(s=>/^[-•]\s+/.test(s)).length>1;
    if(multiItem){name=lines[0];issues.push('MULTI_ITEM_DESCRIPTION');}
    else{
      const priceLines=lines.filter(s=>/^(?:CAD|USD)?\s*\$/.test(s));
      if(priceLines.length===1)price=hub_descParseMoney_(priceLines[0]);
      const body=lines.filter(s=>!priceLines.includes(s));
      const first=body[0]||'';
      const leading=first.match(/^([A-Za-z0-9][A-Za-z0-9._\/-]*)(?:[ \t]+(.*))?$/);
      if(leading&&/\d/.test(leading[1])){itemNumber=leading[1];name=[leading[2]||'',...body.slice(1)].join(' ').trim();}
      else name=body.join(' ').trim();
      issues.push('NONSTANDARD_FORMAT');
    }
  }
  const sourceItemNumber=itemNumber,sourceItemName=name;
  if(itemNumber&&!hub_descValidNumber_(itemNumber)){issues.push('INVALID_ITEM_NUMBER');itemNumber='';}
  if(name&&!hub_descValidName_(name)){issues.push('INVALID_ITEM_NAME');name='';}
  if(!itemNumber)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
  return {raw,normalized,itemNumber,name,price,sourceItemNumber,sourceItemName,multiItem,format,labels,issues:[...new Set(issues)]};
}

const HUB_ENP_DESCRIPTION_ALIASES={
 '77L70':{sku:'SV4.5L6',name:'6" Length Rigid DV Vent',url:'https://ihp.us.com/wp-content/uploads/2021/09/901189-00_A_AST_ScorpioCD_35_40_45-C_DEN-DEP_DV_FP_ECO_IICO.pdf'},
 '77L75':{sku:'SV4.5LA',name:'Adjustable Length Slip Section (2" - 7.5") - rigid',url:'https://ihp.us.com/wp-content/uploads/2021/09/901189-00_A_AST_ScorpioCD_35_40_45-C_DEN-DEP_DV_FP_ECO_IICO.pdf'}
};
function hub_enpClassifyRecord_(row,catalog) {
 const parsed=hub_descParseFields_(row.raw),issues=[],evidence=[],manual=!String(row.raw||'').trim();
 let sku=manual?String(row.sku||'').trim():parsed.itemNumber;
 let name=manual?String(row.name||'').trim():parsed.name;
 let price=manual?hub_descParseMoney_(row.price):parsed.price;
 let numberStatus=sku?'SOURCE_VALUE':'MISSING',nameStatus=name?'SOURCE_VALUE':'MISSING',priceStatus=price!==null?'DESCRIPTION_PRICE':'MISSING';
 if(manual){priceStatus=price!==null?'MANUAL_VALUE':'MISSING';}
 if(!manual&&parsed.format==='UNLABELED')issues.push('NONSTANDARD_FORMAT');
 if(parsed.multiItem){return {row:row.row,itemNumber:'',itemName:'BDM VENTING — multiple components; split required',price:null,category:'MULTI_ITEM',numberStatus:'SPLIT_REQUIRED',nameStatus:'MULTI_COMPONENT_DESCRIPTION',priceStatus:'AGGREGATE_NOT_ALLOCATED',issues:['MULTI_ITEM_DESCRIPTION'],evidence:['Original Description contains multiple bullet components; SO line total is not an individual item price.'],original:row.raw};}
 if(!sku&&parsed.sourceItemNumber&&hub_descValidName_(parsed.sourceItemNumber)) name=parsed.sourceItemNumber+' — '+name;
 if(sku&&!hub_descValidNumber_(sku)){issues.push('INVALID_ITEM_NUMBER');sku='';numberStatus='INVALID';}
 if(name&&!hub_descValidName_(name)){issues.push('INVALID_ITEM_NAME');name='';nameStatus='INVALID';}
 if(parsed.issues.includes('INVALID_ITEM_NUMBER')){issues.push('INVALID_ITEM_NUMBER');numberStatus='INVALID';}
 if(parsed.issues.includes('INVALID_ITEM_NAME'))issues.push('INVALID_ITEM_NAME');
 for(const x of parsed.issues.filter(x=>/^DUPLICATE_|INVALID_PRICE|LABEL_STRUCTURE|UNEXPECTED_CONTINUATION/.test(x)))issues.push(x);
 // An explicitly documented manufacturer alias can reuse a known local model.
 const originalSku=sku,alias=HUB_ENP_DESCRIPTION_ALIASES[sku.toUpperCase()];
 if(alias){sku=alias.sku;name=alias.name;numberStatus='VERIFIED_MANUFACTURER_ALIAS';nameStatus='VERIFIED_MANUFACTURER_ALIAS';evidence.push(alias.url+' — '+originalSku+' = '+sku);}
 // DUR is a vendor prefix in this supplied row, not the part number.
 if(!sku&&/^DUR\s+4BVK\s+/i.test(parsed.normalized)){
   sku='4BVK';name=parsed.normalized.replace(/^DUR\s+4BVK\s+/i,'').replace(/\s+/g,' ');numberStatus='MANUFACTURER_VERIFIED';nameStatus='SOURCE_VALUE';
   evidence.push('https://duravent.com/literature/DV_BVGV_CT-001E_04-24_web.pdf — 4BVK roof top termination kit');
 }
 const all=catalog.filter(r=>String(r.sku).trim().toUpperCase()===sku.toUpperCase()&&sku);
 const usable=all.filter(r=>hub_descValidNumber_(r.sku)&&(hub_descValidName_(r.name)||alias)&&Number(r.id)>0);
 const ids=[...new Set(usable.map(r=>Number(r.id)))];
 let exact=null;
 if(ids.length===1){exact=usable.find(r=>r.source==='masterInventory')||usable[0];sku=String(exact.sku).trim();if(numberStatus==='SOURCE_VALUE')numberStatus='EXACT_CATALOG_IDENTITY';evidence.push(exact.source+' row '+exact.sourceRow+'; Item ID '+exact.id);}
 else if(ids.length>1)issues.push('AMBIGUOUS_CATALOG_IDENTITY');
 else if(all.length){issues.push('CORRUPT_CATALOG_MATCH');evidence.push('Matching catalog row has invalid item number/name; not accepted as authoritative.');}
 else if(sku&&!['MANUFACTURER_VERIFIED'].includes(numberStatus))issues.push('NO_CATALOG_IDENTITY');
 if(exact&&!hub_descValidName_(exact.name))issues.push('CATALOG_NAME_REPAIR_REQUIRED');
 if(!name&&exact&&hub_descValidName_(exact.name)){name=String(exact.name).trim();nameStatus='EXACT_CATALOG_FILL';}
 if(!sku&&name){
   const normal=s=>String(s).trim().replace(/\s*\([^()]+\)\s*$/,'').replace(/\s+/g,' ').toUpperCase();
   const candidates=catalog.filter(r=>hub_descValidNumber_(r.sku)&&normal(r.name)===normal(name));
   const candidateIds=[...new Set(candidates.map(r=>r.id))];
   if(candidateIds.length){evidence.push('Name-only candidate(s), not auto-selected: '+[...new Set(candidates.map(r=>String(r.sku)+' / ID '+r.id))].join('; '));issues.push('NAME_ONLY_CANDIDATE_REQUIRES_CONTEXT');}
 }
 if(price===null&&typeof row.soPrice==='number'&&Number.isFinite(row.soPrice)&&row.soPrice>0){price=row.soPrice;priceStatus='SO_LINE_PRICE_FALLBACK';evidence.push('ENTERNEWPART!W'+row.row+' sales-order line price; not independently verified supplier list price.');}
 if(price===null&&exact&&typeof exact.price==='number'&&Number.isFinite(exact.price)&&exact.price>0){price=exact.price;priceStatus='EXACT_CATALOG_PRICE';evidence.push(exact.source+'!F'+exact.sourceRow+' existing item selling price; not supplier list cost input.');}
 if(price!==null&&typeof row.soPrice==='number'&&row.soPrice!==price)issues.push('ORDER_PRICE_DIFFERS');
 if(price!==null&&exact&&typeof exact.price==='number'&&exact.price!==price){issues.push('CATALOG_PRICE_DIFFERS');evidence.push('Catalog price '+exact.price+' differs from selected transaction/description price '+price+'.');}
 if(price===0)issues.push('ZERO_PRICE_REQUIRES_REVIEW');
 if(!sku)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
 const outName=hub_descCanonicalName_(name,sku);
 let category;
 if(!sku&&!name&&price===null)category='NO_ITEM_INFORMATION';
 else if(issues.some(x=>/^INVALID_|^CORRUPT_CATALOG|^DUPLICATE_|^LABEL_STRUCTURE|^UNEXPECTED_CONTINUATION/.test(x)))category='INCORRECT_INFORMATION';
 else if(issues.some(x=>/^MISSING_/.test(x)))category='PARTIAL_INFORMATION';
 else if(issues.some(x=>/DIFFERS|AMBIGUOUS|ZERO_PRICE/.test(x)))category='CONFLICTING_INFORMATION';
 else if(issues.some(x=>/NO_CATALOG|CATALOG_NAME/.test(x)))category='IDENTITY_REVIEW';
 else category=parsed.format==='UNLABELED'&&!manual?'FORMAT_RECOVERED':manual?'MANUAL_SOURCE':'STRUCTURED';
 return {row:row.row,itemNumber:sku,itemName:outName,price,category,numberStatus,nameStatus,priceStatus,issues:[...new Set(issues)],evidence,original:row.raw};
}
