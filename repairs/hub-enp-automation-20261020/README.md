# Authorized multi-row ENTERNEWPART automation

Central Hub menu: Preview all ENTERNEWPART rows; Enable ENTERNEWPART automation; Pause ENTERNEWPART automation; Process eligible ENTERNEWPART rows now. Direct installer: `hub_enableEnternewpartAutomation`. Worker: `hub_processEnternewpartAutomation`.

The installer creates one 5-minute trigger for this worker and sets a Hub enable flag. It does not authorize rows or install item refresh/report triggers. A separate pause action stops business processing without deleting unrelated triggers. Installing the trigger requires one authorized run in the bound Hub project because remote execution is not available.

Rows require boolean Create Authorized. Quoted rows additionally require boolean Quoted Authorization and matching live Quoted status. Approved rows require matching live Approved status. Manual rows with no SO create/reuse a catalog item only. Completed rows are skipped. Catalog values, identity, exact raw SO SKU, quantity, separate SO line price, currency, fixed fields, textual UPC and duplicate-SKU consistency are checked. Incomplete/conflicting rows stay for review. Serial YES and nonblank MAP remain blocked because API write support has not been verified.

Every eligible row uses live exact lookup, verified reference IDs, guarded create/reuse, item ID capture, readback, and the legacy SO replacement engine with CF820 verification. Catalog price and SO line price remain separate. Existing Hub GL defaults are retained. No credentials, reference IDs, or missing metadata are guessed.

Each run processes at most two rows with a three-minute start budget, a five-minute lease to prevent competing workers, a one-second interval between Striven requests, 90-second cooldown after HTTP429, ten-minute per-row retry delay and at most three attempts for unchanged inputs. Changing reviewed business inputs resets the attempt state. Existing item IDs and uncertain-create parking survive failure. The exact worker trigger is idempotent; other triggers remain untouched.

Deployment fresh-pulls and backs up all sources, reconstructs the previous generated Hub for an exact baseline comparison, changes only the existing Hub source file, verifies the full pulled-back project, and rolls back on failure. Deployment itself neither installs triggers nor executes item/SO mutations. Generated full source and dependency receipt are retained in GitHub Actions artifacts.
