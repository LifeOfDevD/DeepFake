# Security Boundaries Specification

For the complete architectural overview and trust zone topology, see:
* **[Security Boundaries & Trust Architecture](../architecture/security-boundaries.md)**

---

## Key Enforcements

1. **Zone 0 (Untrusted Inbound):** All incoming webhooks and user-submitted URLs pass through strict SSRF validation and HMAC signature checks.
2. **Zone 1 (Edge Protection):** Helmet security headers, Content Security Policy, and sliding-window rate limiters protect the HTTP ingress.
3. **Zone 2 (Application Boundary):** Authentication via HMAC tokens and multi-tenant scoping (`WHERE organization_id = ?`) prevent cross-tenant leakage (Anti-BOLA).
4. **Zone 3 (Forensic Storage):** Streaming SHA-256 custody, opaque UUID keys, WORM compliance, and short-lived HMAC download tokens secure evidence.
5. **Zone 4 (External Platform Boundary):** Live platform mutations are hard-disabled (`ENABLE_LIVE_PLATFORM_ACTIONS = false`), backed by an emergency kill switch.
