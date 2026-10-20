# Hub SO inventory-location dependency repair

Observed execution saved Item ID 43445 and then stopped with `Missing Script Property: ENTERNEWPART_DEFAULT_INVENTORY_LOCATION_ID` during replacement planning. The legacy SO engine eagerly asks for this default even when the line/item has a location.

The Hub override resolves the exact Ajax warehouse ID from the verified Hub reference registry instead of requiring a copied legacy property. Unknown, ambiguous, unverified or conflicting configured values remain blocked. The location is resolved before any new item POST. Retry retains the existing exact lookup and ID capture, so an existing item is reused.

Full Hub backup, reconstructed source baseline check, prior legacy tests, response-parser regressions, and native Hub boundary tests run before a one-file push. The full project is pulled back and compared, with rollback on failure. Deployment does not run a business mutation.
