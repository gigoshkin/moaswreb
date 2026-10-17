import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredTrip } from '@transit/shared';
import { deviceHash, type Sealer } from './crypto.ts';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeviceTrips {
  device: string;
  pushToken: string | null;
  trips: StoredTrip[];
}

/**
 * Per-device trips and push token in SQLite. Trips and token are sealed
 * (AES-GCM); the device is stored as a hash. Only last_seen is plain, for the
 * 30-day auto-delete.
 */
export class TripStore {
  private readonly db: DatabaseSync;
  private readonly sealer: Sealer;

  constructor(dataDir: string, sealer: Sealer, file = 'app.sqlite') {
    if (file !== ':memory:') mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(file === ':memory:' ? file : join(dataDir, file));
    this.sealer = sealer;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device TEXT PRIMARY KEY,
        trips TEXT NOT NULL,
        push_token TEXT,
        last_seen INTEGER NOT NULL
      )`);
  }

  get(deviceId: string): StoredTrip[] {
    const row = this.db.prepare('SELECT trips FROM devices WHERE device = ?').get(deviceHash(deviceId)) as
      | { trips: string }
      | undefined;
    this.touch(deviceId);
    return row ? this.sealer.open<StoredTrip[]>(row.trips) : [];
  }

  putTrips(deviceId: string, trips: StoredTrip[]): void {
    this.db
      .prepare(
        `INSERT INTO devices (device, trips, last_seen) VALUES (?, ?, ?)
         ON CONFLICT(device) DO UPDATE SET trips = excluded.trips, last_seen = excluded.last_seen`,
      )
      .run(deviceHash(deviceId), this.sealer.seal(trips), Date.now());
  }

  putPushToken(deviceId: string, token: string): void {
    this.db
      .prepare(
        `INSERT INTO devices (device, trips, push_token, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT(device) DO UPDATE SET push_token = excluded.push_token, last_seen = excluded.last_seen`,
      )
      .run(deviceHash(deviceId), this.sealer.seal([]), this.sealer.seal(token), Date.now());
  }

  delete(deviceId: string): void {
    this.db.prepare('DELETE FROM devices WHERE device = ?').run(deviceHash(deviceId));
  }

  /** Every device with its trips, for the alert watcher. */
  all(): DeviceTrips[] {
    const rows = this.db.prepare('SELECT device, trips, push_token FROM devices').all() as Array<{
      device: string;
      trips: string;
      push_token: string | null;
    }>;
    return rows.map((r) => ({
      device: r.device,
      trips: this.sealer.open<StoredTrip[]>(r.trips),
      pushToken: r.push_token ? this.sealer.open<string>(r.push_token) : null,
    }));
  }

  /** Auto-delete devices that haven't checked in for 30 days. Returns how many were removed. */
  purge(now = Date.now()): number {
    return Number(this.db.prepare('DELETE FROM devices WHERE last_seen < ?').run(now - RETENTION_MS).changes);
  }

  private touch(deviceId: string): void {
    this.db.prepare('UPDATE devices SET last_seen = ? WHERE device = ?').run(Date.now(), deviceHash(deviceId));
  }
}
