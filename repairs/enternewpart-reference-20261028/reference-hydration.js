function enp_legacyHydrateReferences_(record,base) {
  const fields={ItemType:['itemType','Inventory','ItemType'],DefaultInventoryLocation:['defaultInventoryLocation',record['Location Name'],'LocationName'],Category:['category',record['Item Category'],'ItemCategory'],PreferredVendor:['preferredVendor',record['Preferred Vendor'],'PreferredVendor'],Manufacturer:['manufacturer',record.Manufacturer,'Manufacturer']};
  const props=PropertiesService.getScriptProperties(),raw=props.getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
  const registry=raw?JSON.parse(raw):{},sheet=enp_guardHubBook_().getSheetByName('DATA_ITEMS');
  if(!sheet)throw new Error('DATA_ITEMS cache missing; cannot select live reference witnesses');
  const grid=sheet.getDataRange().getValues(),c=enp_indexByHeader_(grid[0]),ids=[],evidence={};
  Object.keys(fields).forEach(function(field){
    evidence[field]={};const pair=fields[field],col=c[pair[2]];
    if(col==null||c.Id==null||c.ItemNumber==null)throw new Error('HUB_METADATA_BLOCKED: DATA_ITEMS missing '+pair[2]);
    let n=0;const seen={};
    for(const row of grid.slice(1)){
      const id=Number(row[c.Id]);
      if(!enp_guardUpper_(row[c.ItemNumber])||enp_guardUpper_(row[col])!==enp_guardUpper_(pair[1])||!Number.isSafeInteger(id)||id<=0||seen[id])continue;
      seen[id]=true;if(ids.indexOf(id)<0)ids.push(id);if(++n>=6)break;
    }
  });
  for(const id of ids){
    const live=enp_legacyLiveItem_(id);
    Object.keys(fields).forEach(function(field){
      const pair=fields[field],ref=live[pair[0]]||live[field]||{},name=ref.name!=null?ref.name:ref.Name,rid=Number(ref.id!=null?ref.id:ref.Id);
      if(enp_guardUpper_(name)===enp_guardUpper_(pair[1])&&Number.isSafeInteger(rid)&&rid>0)evidence[field][rid]=id;
    });
  }
  Object.keys(fields).forEach(function(field){
    const found=Object.keys(evidence[field]);
    if(found.length!==1)throw new Error('HUB_METADATA_BLOCKED: missing or ambiguous verified '+field+' ID for '+fields[field][1]);
    const rid=Number(found[0]),id=evidence[field][found[0]];
    registry[field]=[{Id:rid,Name:fields[field][1],Verified:true,Evidence:'GET /v1/items/'+id+' on '+new Date().toISOString()}];
  });
  if(base.ItemType&&Number(base.ItemType.Id)!==enp_guardHubReference_(registry,'ItemType','Inventory').Id)throw new Error('Legacy default item type differs from live Inventory type');
  base.ItemType=enp_guardHubReference_(registry,'ItemType','Inventory');
  registry.BaseCurrency='CAD';registry.LegacyUntrackedItemNumbers=['G190-0004-SER'];
  props.setProperty('ENTERNEWPART_HUB_REFERENCE_IDS',JSON.stringify(registry));
}
