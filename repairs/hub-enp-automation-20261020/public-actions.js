/* Google Apps Script — Central Hub scheduling and manual controls. */
function hub_previewEnternewpartAutomation() {
 const result=hub_row2LegacyEngine_().enp_hubPreviewAllRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_processEnternewpartAutomation() {
 const result=hub_row2LegacyEngine_().enp_hubRunEligibleRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_enableEnternewpartAutomation() {
 const handlers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='hub_processEnternewpartAutomation';});
 if(!handlers.length)ScriptApp.newTrigger('hub_processEnternewpartAutomation').timeBased().everyMinutes(5).create();
 // Reinstallation removes only duplicate triggers for this exact handler.
 handlers.slice(1).forEach(function(t){ScriptApp.deleteTrigger(t);});
 PropertiesService.getScriptProperties().setProperty('HUB_ENP_AUTOMATION_ENABLED','true');
 const preview=hub_previewEnternewpartAutomation(),result={status:'INSTALLED',everyMinutes:5,maxRowsPerRun:2,eligible:preview.eligible,completed:preview.completed,unauthorized:preview.unauthorized};
 Logger.log(JSON.stringify(result));return result;
}
function hub_pauseEnternewpartAutomation() {
 PropertiesService.getScriptProperties().setProperty('HUB_ENP_AUTOMATION_ENABLED','false');
 const result={status:'PAUSED',strivenCalls:0};Logger.log(JSON.stringify(result));return result;
}
