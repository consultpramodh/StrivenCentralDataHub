// JavaScript / Node.js; pure functions also embedded in Google Apps Script.
'use strict';
function normalizeDescriptionText(text) {
  return String(text == null ? '' : text).replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/&#x([0-9a-f]+);/gi,(whole,x)=>{const n=parseInt(x,16);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&#(\d+);/g,(whole,x)=>{const n=Number(x);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'")
    .replace(/\r\n?/g,'\n').replace(/[\u00a0\u202f]/g,' ').trim();
}
function parseMoneyStrict(text) {
  if (text == null || String(text).trim()==='') return null;
  let s=String(text).trim().replace(/[\u00a0\u202f]/g,' ');
  s=s.replace(/^(?:CAD|USD)[ \t]*/i,'').replace(/^\$[ \t]*/,'');
  if (!/^(?:\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?: \d{3})+(?:\.\d{1,2})?)$/.test(s)) return null;
  const n=Number(s.replace(/[, ]/g,''));
  return Number.isFinite(n)&&n>=0&&n<=9999999999998?n:null;
}
function validItemNumber(value) {
  const s=String(value||'').trim();
  return !!s && !/[\r\n]|(?:item\s*name|item\s*number|price)\s*:/i.test(s) &&
    s.split(/\s+/).length<5 && !/["<>]/.test(s) && s.toUpperCase()!=='ENTERNEWPART';
}
function validItemName(value) {
  const s=String(value||'').trim();
  return !!s && !/^(?:item\s*name|item\s*number|price)\s*:/i.test(s) && !/^NEEDSSKU\b/i.test(s);
}
function canonicalItemName(name,number) {
  let s=String(name||'').trim().replace(/\s+/g,' '),sku=String(number||'').trim();
  if (!s) return '';
  if (!sku) return s;
  const suffix=' ('+sku+')';
  while(s.toUpperCase().endsWith(suffix.toUpperCase()))s=s.slice(0,-suffix.length).trim();
  return s?s+suffix:'';
}
function parseDescriptionFields(text) {
  const raw=String(text==null?'':text),normalized=normalizeDescriptionText(raw),issues=[];
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
    price=values.price.length===1?parseMoneyStrict(values.price[0]):null;
    if(labels.join(',')!=='number,name,price')issues.push('LABEL_STRUCTURE');
    if(values.price[0]&&price===null)issues.push('INVALID_PRICE');
  }else if(normalized){
    multiItem=lines.filter(s=>/^[-•]\s+/.test(s)).length>1;
    if(multiItem){name=lines[0];issues.push('MULTI_ITEM_DESCRIPTION');}
    else{
      const priceLines=lines.filter(s=>/^(?:CAD|USD)?\s*\$/.test(s));
      if(priceLines.length===1)price=parseMoneyStrict(priceLines[0]);
      const body=lines.filter(s=>!priceLines.includes(s));
      const first=body[0]||'';
      const leading=first.match(/^([A-Za-z0-9][A-Za-z0-9._\/-]*)(?:[ \t]+(.*))?$/);
      if(leading&&/\d/.test(leading[1])){itemNumber=leading[1];name=[leading[2]||'',...body.slice(1)].join(' ').trim();}
      else name=body.join(' ').trim();
      issues.push('NONSTANDARD_FORMAT');
    }
  }
  const sourceItemNumber=itemNumber,sourceItemName=name;
  if(itemNumber&&!validItemNumber(itemNumber)){issues.push('INVALID_ITEM_NUMBER');itemNumber='';}
  if(name&&!validItemName(name)){issues.push('INVALID_ITEM_NAME');name='';}
  if(!itemNumber)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
  return {raw,normalized,itemNumber,name,price,sourceItemNumber,sourceItemName,multiItem,format,labels,issues:[...new Set(issues)]};
}
module.exports={normalizeDescriptionText,parseMoneyStrict,validItemNumber,validItemName,canonicalItemName,parseDescriptionFields};
