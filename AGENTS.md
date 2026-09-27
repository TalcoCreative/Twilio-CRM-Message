# Project Architecture Rules

- Keep Twilio outbound Content SIDs as separate `system_settings` keys so adding a campaign template never replaces an existing template.
