import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A small keyed JSON store; writes are serialized so concurrent updates never lose each other. */
export interface RecordStore<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(record: T): Promise<void>;
}

export function memoryRecordStore<T extends { id: string }>(initial: T[] = []): RecordStore<T> {
  const records = new Map(initial.map((r) => [r.id, structuredClone(r)]));
  return {
    list: async () => [...records.values()].map((r) => structuredClone(r)),
    get: async (id) => (records.has(id) ? structuredClone(records.get(id)!) : undefined),
    put: async (record) => {
      records.set(record.id, structuredClone(record));
    },
  };
}

export function fileRecordStore<T extends { id: string }>(path: string, isRecord: (v: unknown) => v is T): RecordStore<T> {
  async function read(): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isRecord) : [];
  }

  let queue: Promise<void> = Promise.resolve();
  return {
    list: read,
    get: async (id) => (await read()).find((r) => r.id === id),
    put: (record) => {
      const write = queue.then(async () => {
        const records = (await read()).filter((r) => r.id !== record.id);
        records.push(record);
        await mkdir(dirname(path), { recursive: true });
        const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, "utf8");
        await rename(tmp, path);
      });
      queue = write.catch(() => undefined);
      return write;
    },
  };
}
