import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class JsonStore {
  private dataDir: string;
  private collections = new Map<string, Map<string, Record<string, unknown>>>();
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushDelay = 500; // ms

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const files = fs.readdirSync(this.dataDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const col = file.replace('.json', '');
      const filePath = path.join(this.dataDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const records: Record<string, unknown>[] = JSON.parse(raw);
        const map = new Map<string, Record<string, unknown>>();
        for (const rec of records) {
          if (rec && typeof rec === 'object' && 'id' in rec && typeof rec.id === 'string') {
            map.set(rec.id, rec);
          }
        }
        this.collections.set(col, map);
      } catch {
        this.collections.set(col, new Map());
      }
    }
  }

  private ensureCollection(col: string): Map<string, Record<string, unknown>> {
    let map = this.collections.get(col);
    if (!map) {
      map = new Map();
      this.collections.set(col, map);
    }
    return map;
  }

  private scheduleSave(col: string): void {
    this.dirty.add(col);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushDirty();
    }, this.flushDelay);
  }

  private async flushDirty(): Promise<void> {
    const cols = [...this.dirty];
    this.dirty.clear();
    for (const col of cols) {
      this.writeCollection(col);
    }
  }

  private writeCollection(col: string): void {
    const map = this.collections.get(col);
    if (!map) return;
    const records = [...map.values()];
    const filePath = path.join(this.dataDir, `${col}.json`);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2));
    fs.renameSync(tmpPath, filePath);
  }

  getAll(col: string): Record<string, unknown>[] {
    const map = this.ensureCollection(col);
    return [...map.values()];
  }

  getById(col: string, id: string): Record<string, unknown> | null {
    const map = this.ensureCollection(col);
    return map.get(id) ?? null;
  }

  find(col: string, predicate: (r: Record<string, unknown>) => boolean): Record<string, unknown>[] {
    const map = this.ensureCollection(col);
    return [...map.values()].filter(predicate);
  }

  findOne(
    col: string,
    predicate: (r: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | null {
    const map = this.ensureCollection(col);
    for (const rec of map.values()) {
      if (predicate(rec)) return rec;
    }
    return null;
  }

  count(col: string, predicate?: (r: Record<string, unknown>) => boolean): number {
    const map = this.ensureCollection(col);
    if (!predicate) return map.size;
    let n = 0;
    for (const rec of map.values()) {
      if (predicate(rec)) n++;
    }
    return n;
  }

  insert(col: string, data: Record<string, unknown>): Record<string, unknown> {
    const map = this.ensureCollection(col);
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      ...data,
      id: (data.id as string) || crypto.randomUUID(),
      createdAt: (data.createdAt as string) || now,
      updatedAt: (data.updatedAt as string) || now,
    };
    map.set(record.id as string, record);
    this.scheduleSave(col);
    return record;
  }

  insertMany(col: string, items: Record<string, unknown>[]): Record<string, unknown>[] {
    return items.map((item) => this.insert(col, item));
  }

  update(
    col: string,
    id: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const map = this.ensureCollection(col);
    const existing = map.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated: Record<string, unknown> = {
      ...existing,
      ...data,
      id, // prevent id override
      updatedAt: now,
    };
    map.set(id, updated);
    this.scheduleSave(col);
    return updated;
  }

  delete(col: string, id: string): Record<string, unknown> | null {
    const map = this.ensureCollection(col);
    const existing = map.get(id);
    if (!existing) return null;
    map.delete(id);
    this.scheduleSave(col);
    return existing;
  }

  deleteWhere(
    col: string,
    predicate: (r: Record<string, unknown>) => boolean,
  ): Record<string, unknown>[] {
    const map = this.ensureCollection(col);
    const deleted: Record<string, unknown>[] = [];
    for (const [id, rec] of map) {
      if (predicate(rec)) {
        map.delete(id);
        deleted.push(rec);
      }
    }
    if (deleted.length > 0) this.scheduleSave(col);
    return deleted;
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Write all collections that have data
    for (const col of this.collections.keys()) {
      this.writeCollection(col);
    }
    this.dirty.clear();
  }
}
