# ADR-003: Read-Only Provider API Integrations

## Status
**Accepted**

## Context
When integrating with social platforms (e.g., YouTube, Meta, X) to monitor impersonation signals and sync takedown statuses, requesting write/mutation scopes (e.g. `youtube.force-ssl` or account management scopes) poses severe security risks. If an OAuth token is compromised, an attacker could tamper with client accounts or dispatch unauthorized mutations.

## Decision
We enforce strict **Read-Only API Scoping** across all external platform adapters:
1. **Scope Restriction:** The YouTube adapter is strictly pinned to `youtube.readonly` (`src/services/integrations/youtube-adapter.ts`).
2. **Inbound WebSub Webhooks:** Push notifications use WebSub with HMAC signature verification; secret hashes are stored in the database, never raw secrets.
3. **Encrypted Token Storage:** Stored OAuth refresh and access tokens are encrypted at rest using AES-256-GCM (`token-encryption.ts`) with key rotation support.
4. **Zero Scraping:** Scraping without API authentication is banned in favor of official read-only endpoints and webhooks.

## Consequences
* **Positive:** Drastically reduced attack surface; full compliance with Google/YouTube Developer API terms; token compromise cannot lead to account hijacking.
* **Tradeoff:** Takedown notices cannot be submitted directly via API; notices must be submitted via verified web forms or legal grievance portals by human operators.
