import type { DatabaseSync } from 'node:sqlite';

export interface AuditEvent {
  userId: number | null;
  action: string;
  entityType?: string;
  entityId?: number;
  detail?: unknown;
  ip?: string;
}

export function audit(db: DatabaseSync, event: AuditEvent): void {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    event.userId,
    event.action,
    event.entityType ?? null,
    event.entityId ?? null,
    event.detail === undefined ? null : JSON.stringify(event.detail),
    event.ip ?? null,
  );
}
