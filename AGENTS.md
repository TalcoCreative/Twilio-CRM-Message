# Project Architecture Rules

- Keep Twilio outbound Content SIDs as separate `system_settings` keys so adding a campaign template never replaces an existing template.
- Scope Inbox conversation caches to the signed-in user and distinguish loading failures from successful empty results so private data cannot cross account changes and failed reads remain retryable.
