# Engineering Specifications & Deep Dives

**Application:** Digital Impersonation Response Desk  
**Baseline Release:** `v1.0.0-controlled-pilot-rc2`  

---

## Overview

This directory provides in-depth technical documentation covering the software engineering practices, cryptographic algorithms, state machines, and lifecycle management implemented across the Digital Impersonation Response Desk.

## Engineering Guides

1. **[Graph Engineering](graph-engineering.md):** Architectural methodology, node execution models, parallel fan-out/fan-in pipelines, and tradeoffs against conventional loops.
2. **[Evidence & Chain of Custody](evidence-chain-of-custody.md):** Cryptographic guarantees, streaming SHA-256 verification, WORM storage compliance, HMAC download tokens, and legal hold lifecycle management.
