/** Google Apps Script — current snapshot calculation verification. */
function test_RebuildCurrentPoSnapshot() { hub_refreshPoSalesScope(); return hub_rebuildPoAnalysisFromLastSnapshot(); }

/** Google Apps Script — current PO analysis release test. */
function test_PoAnalysisRefreshAndVerify() {
  const f={TransactionDetailId:1,TransactionTransactionId:1,TransactionNumber:'TEST',TransactionTransactionDate:'06/30/2026',TransactionType:'Invoice',TransactionStatus:'Active',TransactionHistoricalNonPosting:'No',ItemItemId:1,ItemNumber:'TEST',ItemName:'TEST',Description:'',Qty:2,Amount:20,InventoryLocation:null};
  const scope={'1':[1,'TEST','TEST',2,0,0,2,1,1,'']},inv={'1':['',1,'TEST','TEST',3,1,4,0,2,1,'',2,0,'TEST']};
  const result=hub_poCompute_([f,Object.assign({},f,{TransactionDetailId:2,TransactionTransactionDate:'07/01/2026',Qty:3}),Object.assign({},f,{TransactionDetailId:3,TransactionStatus:'Voided',Qty:100}),Object.assign({},f,{TransactionDetailId:4,TransactionHistoricalNonPosting:'Yes',Qty:100}),Object.assign({},f,{TransactionDetailId:5,TransactionType:'Credit Memo',Qty:1}),Object.assign({},f,{TransactionDetailId:6,TransactionTransactionDate:'10/07/2026',Qty:100})],scope,inv,'2026-10-06');
  if(result.gross[0]!==2||result.gross[1]!==3||result.review.length!==2||result.summary[1][11]!==''||result.summary[1][12]!==3||result.summary[1][17]!==1)throw new Error('PO calculation boundary/status/credit test failed.');
  let invalidDateRejected=false;try{hub_poDate_('02/30/2026');}catch(e){invalidDateRejected=true;}if(!invalidDateRejected)throw new Error('Invalid date accepted.');
  const live=hub_refreshPoAnalysis();
  if(live.strivenWritesPerformed!==false||live.status!=='PASS_WITH_EXCEPTIONS')throw new Error('Live refresh did not pass.');
  const ss=SpreadsheetApp.getActive(),summary=ss.getSheetByName('PO_SALES_SUMMARY').getDataRange().getValues();
  if(summary.length-1!==live.items||summary.slice(1).reduce((n,r)=>n+Number(r[6]),0)!==live.ordered||summary.slice(1).reduce((n,r)=>n+Number(r[7]),0)!==live.grossJanJun||summary.slice(1).reduce((n,r)=>n+Number(r[8]),0)!==live.grossJulThrough)throw new Error('Live summary does not reconcile.');
  const out={test:'test_PoAnalysisRefreshAndVerify',status:'PASS',businessDataStatus:live.status,result:live};Logger.log(JSON.stringify(out));return out;
}

/** Google Apps Script — read-only current PO scope inspection. */
function test_CurrentPoScopeSource() { return hub_inspectPoScopeChanges(); }
