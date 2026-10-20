// JavaScript / Node.js — native Google Sheets cost formula definitions.
'use strict';
const CALCULATED_COST_FORMULA="=ARRAYFORMULA(IF(LEN($B2:$B&$R2:$R&$AF2:$AF)=0,\"\",IFERROR(IF(ISNUMBER($AL2:$AL)*($AL2:$AL>=0)*ISNUMBER($AD2:$AD)*($AD2:$AD>=0)*($AD2:$AD<=1)*($AM2:$AM<>\"\")*($Q2:$Q<>\"\")*(UPPER(TRIM($AM2:$AM))=UPPER(TRIM($Q2:$Q)))*(LEN(TRIM($AN2:$AN))>0)*ISLOGICAL($AO2:$AO)*($AO2:$AO=TRUE),ROUND($AL2:$AL*(1-$AD2:$AD),2),\"\"),\"\")))";
const COST_STATUS_FORMULA="=ARRAYFORMULA(IF(LEN($B2:$B&$R2:$R&$AF2:$AF)=0,\"\",IF($AP2:$AP<>\"\",IF($E2:$E=$AP2:$AP,\"CALCULATED — verified supplier inputs\",\"REVIEW — calculated cost differs; existing retained\"),IF($E2:$E<>\"\",IF($E2:$E=0,\"REVIEW — existing cost is zero\",\"EXISTING COST — preserved\"),IF($AL2:$AL=\"\",\"BLOCKED — supplier list price missing\",IF($AD2:$AD=\"\",\"BLOCKED — applicable discount missing\",IF(ISNUMBER($AL2:$AL)*($AL2:$AL>=0)*ISNUMBER($AD2:$AD)*($AD2:$AD>=0)*($AD2:$AD<=1)=0,\"BLOCKED — invalid price or discount\",IF(($AM2:$AM=\"\")+($Q2:$Q=\"\")+(UPPER(TRIM($AM2:$AM))<>UPPER(TRIM($Q2:$Q))),\"BLOCKED — currency missing or mismatched\",IF(LEN(TRIM($AN2:$AN))=0,\"BLOCKED — supplier price source missing\",\"BLOCKED — supplier inputs not verified\")))))))))";
function wrapExistingCostFormula(formula,row) {
  if (!Number.isInteger(row) || row<2 || row>500) throw Error('Expected row 2..500');
  if (!formula) return '=IF($AP'+row+'="","",$AP'+row+')';
  if (!formula.startsWith('=')) throw Error('Expected a Sheets formula');
  if (/^=LET\(sourceCost,/i.test(formula) || formula==='=IF($AP'+row+'="","",$AP'+row+')') return formula;
  return '=LET(sourceCost,'+formula.slice(1)+',IF(LEN(TO_TEXT(sourceCost))=0,IF($AP'+row+'="","",$AP'+row+'),sourceCost))';
}
module.exports={CALCULATED_COST_FORMULA,COST_STATUS_FORMULA,wrapExistingCostFormula};
