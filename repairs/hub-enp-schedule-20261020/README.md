# Toronto two-hour ENTERNEWPART schedule

Requested daily slots: 08:00, 10:00, 12:00, 14:00, 16:00, 18:00 America/Toronto. The next one-shot timer is calculated in Toronto local time and rearmed before business work, so it does not continue overnight. DST changes and year rollover are covered. Apps Script may deliver a scheduled callback late; stale callbacks over one hour late are skipped.

The installer replaces only old ENTERNEWPART worker timers, verifies one next trigger, and leaves unrelated triggers alone. A previously installed five-minute worker automatically migrates itself on its next tick with no business work on that migration tick. Completed and held rows, data checks, 2-row run limit, backoff and API throttling are unchanged. Global pause prevents scheduled processing.

The source deployment does not claim that a timer was installed. Remote timer activation previously failed with execution permission denied. If an old timer already exists, the next tick migrates it automatically; otherwise one-time activation still requires an authorized in-Hub execution.
