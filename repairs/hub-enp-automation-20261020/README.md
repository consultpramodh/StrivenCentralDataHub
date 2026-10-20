# Central Hub automatic ENTERNEWPART processing

Daily schedule: **08:00, 10:00, 12:00, 14:00, 16:00 and 18:00 America/Toronto**. No overnight slots. Toronto daylight-saving changes are handled. Each scheduled callback creates and verifies the next one-shot timer before business work; stale callbacks more than one hour late do not process rows. At most two rows are processed per run (up to 12 rows per day).

The user's standing instruction authorizes fully validated Approved, Quoted and Manual rows automatically. The automatic worker does not require the legacy Create Authorized or Quoted Authorization checkboxes. Explicit HOLD, PAUSED and DO NOT CREATE row statuses prevent execution. Global pause remains available. Completed rows are skipped; missing/invalid data, identity/duplicate conflicts and unsupported serial YES/MAP stay for review.

Processing retains exact live item lookup, create/reuse guards, verified metadata reference IDs, saved item IDs, separate catalog and SO line prices, SO quantity preservation, CF820 verification and recovery journals. No metadata IDs or costs are guessed.

An existing five-minute callback migrates to the new schedule on its next tick. The installer replaces only ENTERNEWPART worker timers and preserves unrelated triggers. Manual process/preview controls remain available, but routine processing requires no manual runs. Activation has not been verified through this connection: the latest remote installation attempt was rejected by Google execution permissions. Source deployment is distinct from timer installation.

Latest verified deployment: https://github.com/consultpramodh/StrivenCentralDataHub/actions/runs/39473388544

All 44 native validation/integration groups plus 31 response-envelope cases passed before and after deployment. Full Hub backup and SHA-256 records were retained; all 8 source files were pulled back and compared. The one-file update preserved the independent legacy project.
