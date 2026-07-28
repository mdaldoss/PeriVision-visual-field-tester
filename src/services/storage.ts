import Dexie, { type Table } from "dexie";
import type { DeviceProfile, Session } from "../core/types";

export interface StoredSetting {
  key: string;
  value: unknown;
}

/**
 * Everything stays on this device. There is no server: the test results are
 * health information and the simplest way to keep them private is never to
 * transmit them.
 */
class PeriVisionDb extends Dexie {
  sessions!: Table<Session, string>;
  devices!: Table<DeviceProfile, string>;
  settings!: Table<StoredSetting, string>;

  constructor() {
    super("perivision");
    this.version(1).stores({
      sessions: "id, startedAt",
      devices: "id, calibratedAt",
      settings: "key",
    });
  }
}

let db: PeriVisionDb | null = null;

function getDb(): PeriVisionDb {
  if (!db) db = new PeriVisionDb();
  return db;
}

export async function saveSession(session: Session): Promise<void> {
  await getDb().sessions.put(session);
}

export async function listSessions(limit = 50): Promise<Session[]> {
  const rows = await getDb().sessions.orderBy("startedAt").reverse().limit(limit).toArray();
  return rows;
}

export async function getSession(id: string): Promise<Session | undefined> {
  return getDb().sessions.get(id);
}

export async function deleteSession(id: string): Promise<void> {
  await getDb().sessions.delete(id);
}

export async function saveDeviceProfile(profile: DeviceProfile): Promise<void> {
  await getDb().devices.put(profile);
  await setSetting("lastDeviceId", profile.id);
}

export async function loadLastDeviceProfile(): Promise<DeviceProfile | undefined> {
  const id = await getSetting<string>("lastDeviceId");
  if (!id) return undefined;
  return getDb().devices.get(id);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb().settings.put({ key, value });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await getDb().settings.get(key);
  return row?.value as T | undefined;
}

/** Wipe every trace of the user's data from this browser. */
export async function deleteAllData(): Promise<void> {
  const d = getDb();
  await Promise.all([d.sessions.clear(), d.devices.clear(), d.settings.clear()]);
}

export async function exportAll(): Promise<{
  sessions: Session[];
  devices: DeviceProfile[];
  exportedAt: string;
}> {
  const d = getDb();
  return {
    sessions: await d.sessions.toArray(),
    devices: await d.devices.toArray(),
    exportedAt: new Date().toISOString(),
  };
}

export async function importAll(data: {
  sessions?: Session[];
  devices?: DeviceProfile[];
}): Promise<void> {
  const d = getDb();
  if (data.devices?.length) await d.devices.bulkPut(data.devices);
  if (data.sessions?.length) await d.sessions.bulkPut(data.sessions);
}
