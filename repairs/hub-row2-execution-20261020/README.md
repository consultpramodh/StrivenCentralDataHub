# Central Hub native row-2 execution

`enp_runHubRow2CreateAndReplace` now runs inside the Hub project, using Hub ENTERNEWPART data, credentials, cache, item ID capture and status columns. `hub_previewRow2CreateAndReplace` performs sheet-only validation. Menu entries are added to Central Hub onOpen.

The build pulls current legacy sources, checks three baselines and 34 legacy checks, selects the transitive dependency declarations into a closure in the existing Hub file, verifies unresolved helpers, and ports the recovery watchdog to a global Hub handler. It does not call the remote legacy execution API, read legacy runtime properties, or change the legacy project. No legacy workbook is required at runtime. Source fields come from the Hub original description and SO line price; live order preflight remains mandatory.

Inventory, location, category, vendor and manufacturer IDs are verified from live item witnesses, not guessed or copied from unverified cached IDs. Configured Hub GL defaults are preserved when present; absent optional defaults are omitted. Serial NO retains the row-scoped legacy omission policy; independent serial verification remains unavailable. Other rows remain outside the action scope.

Deployment backs up the full Hub project, patches only 10_Central_Hub.js, checks concurrent drift, pushes the same Hub project, and compares the entire pulled-back project with rollback on failure. Full generated source and dependency receipt are saved with GitHub deployment artifacts. No item create or Sales Order change runs during deployment.
