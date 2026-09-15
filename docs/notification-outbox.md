# Transactional Notification Outbox & In-App Center

## 1. Overview & Architectural Pattern

The **Digital Impersonation Response Desk** implements the **Transactional Outbox Pattern** for all operational notifications and alerts.

In distributed and high-consequence operations, direct network dispatching of emails or SMS inside request handlers creates severe risks of partial failures, unrecorded events, or hanging transactions.

With the transactional outbox:
1. When business actions occur (e.g. clock created, invitation generated, case assigned), a notification record is written to `notification_outbox` **in the same SQLite transaction** as the entity mutation.
2. An asynchronous background loop (`NotificationWorker`) reads pending items from the outbox with retry limits.
3. Delivered notifications materialize in `in_app_notifications` for real-time display in the operator UI.

> [!IMPORTANT]
> **Controlled Pilot Delivery Scope**: No outbound SMTP, SES, SendGrid, or SMS gateways are contacted. Outbox notifications deliver to the local in-app drawer, console logger, and local file storage.

---

## 2. Database Schema

### 2.1 Outbox Table (`notification_outbox`)
```sql
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  recipient_role TEXT,
  recipient_email TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, delivered, failed
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT NOT NULL UNIQUE,
  delivery_channel TEXT NOT NULL DEFAULT 'in_app',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  last_error TEXT
);
```

### 2.2 In-App Notifications Table (`in_app_notifications`)
```sql
CREATE TABLE in_app_notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notification_outbox_id TEXT REFERENCES notification_outbox(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL
);
```

---

## 3. Delivery Adapters

The notification subsystem supports three pluggable local adapters:

1. **`InAppNotificationAdapter` (Default)**:
   - Resolves target user by direct `recipient_user_id`, or all users matching `recipient_role`, or user lookup by `recipient_email`.
   - Inserts unread records into `in_app_notifications`.
2. **`ConsoleNotificationAdapter`**:
   - Formats log line: `[DRY-RUN NOTIFICATION] To: <email> | Type: <type> | Title: <title>`.
   - Zero network overhead.
3. **`FilePreviewNotificationAdapter`**:
   - Serializes complete outbox payloads to disk at `/storage/notifications/preview-<id>.json`.
   - Useful for offline email template auditing and integration testing.

---

## 4. Notification Types & Trigger Conditions

| Notification Type | Trigger Condition | Target Audience |
| :--- | :--- | :--- |
| `invitation` | New user invited to organization via email token | New User |
| `case_assigned` | Case assigned to responder or analyst | Assignee |
| `clock_due_soon` | Statutory clock has <= 6 hours remaining | Assignee & Org Owner |
| `clock_overdue` | Statutory clock exceeds submission deadline | Assignee, Org Owner, System Admin |
| `legal_review_required` | Case marked `requires_legal_review = true` | Legal Team / Counsel |
| `submission_approval_required` | Platform package awaiting sign-off | Org Owner |
| `platform_ack_missing` | Platform acknowledgment not recorded after 24h | Assignee |
| `escalation_created` | Case escalated to Nodal Officer / Grievance Officer | All Responders |
| `evidence_retention_approaching`| Evidence item near 180-day retention window | Auditor |

---

## 5. In-App Notification Center API

The web application interacts with notifications via clean REST endpoints:

### 5.1 Fetch Notifications & Unread Badge Count
```http
GET /api/notifications?unreadOnly=false
Authorization: Bearer <user_token>
```
**Response (HTTP 200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "notif_3a7b9c1d",
      "title": "STATUTORY CLOCK OVERDUE: Case CAS-APEX-2026-001",
      "body": "Rule 3(2)(b) clock deadline exceeded.",
      "notification_type": "clock_overdue",
      "is_read": 0,
      "created_at": "2026-09-12T16:50:00.000Z"
    }
  ],
  "unreadCount": 1
}
```

### 5.2 Mark Individual Notification Read
```http
PATCH /api/notifications/notif_3a7b9c1d/read
Authorization: Bearer <user_token>
```

### 5.3 Mark All Read
```http
POST /api/notifications/read-all
Authorization: Bearer <user_token>
```
