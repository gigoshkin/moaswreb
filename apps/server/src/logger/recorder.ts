import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

export type SnapshotKind = 'routes' | 'route' | 'stop-routes' | 'arrivals' | 'positions';

export interface Snapshot {
  /** ISO time the response arrived */
  t: string;
  kind: SnapshotKind;
  /** stop id or route id the snapshot is about */
  key: string;
  data: unknown;
}

/**
 * Appends raw TTC responses to hourly JSONL files:
 *   <dir>/raw/YYYY-MM-DD/HH.jsonl  (UTC)
 * When the hour changes, the finished file is gzipped. These files are the
 * replay source for the demo and the input for delay statistics.
 */
export class Recorder {
  private readonly rawDir: string;
  private currentPath: string | null = null;
  private stream: WriteStream | null = null;

  written = 0;

  constructor(dataDir: string) {
    this.rawDir = join(dataDir, 'raw');
  }

  async init(): Promise<void> {
    await mkdir(this.rawDir, { recursive: true });
    await this.compressFinishedFiles();
  }

  async write(snapshot: Snapshot): Promise<void> {
    const path = this.pathFor(new Date(snapshot.t));
    if (path !== this.currentPath) await this.rotate(path);
    this.stream!.write(JSON.stringify(snapshot) + '\n');
    this.written++;
  }

  async close(): Promise<void> {
    if (this.stream) await new Promise<void>((r) => this.stream!.end(r));
    this.stream = null;
    this.currentPath = null;
  }

  private pathFor(date: Date): string {
    const iso = date.toISOString();
    return join(this.rawDir, iso.slice(0, 10), `${iso.slice(11, 13)}.jsonl`);
  }

  private async rotate(path: string): Promise<void> {
    await this.close();
    await mkdir(join(path, '..'), { recursive: true });
    this.stream = createWriteStream(path, { flags: 'a' });
    this.currentPath = path;
    // Gzip the previous hour in the background; failures only cost disk space.
    this.compressFinishedFiles().catch((err) => console.error('[recorder] gzip failed', err));
  }

  private async compressFinishedFiles(): Promise<void> {
    const days = await readdir(this.rawDir).catch(() => [] as string[]);
    for (const day of days) {
      const files = await readdir(join(this.rawDir, day));
      for (const file of files) {
        const path = join(this.rawDir, day, file);
        if (!file.endsWith('.jsonl') || path === this.currentPath) continue;
        // A restart within the same hour leaves several files for that hour; never overwrite.
        let target = `${path}.gz`;
        if (await access(target).then(() => true, () => false)) {
          target = path.replace(/\.jsonl$/, `-${Date.now()}.jsonl.gz`);
        }
        await pipeline(createReadStream(path), createGzip(), createWriteStream(target));
        await rm(path);
      }
    }
  }
}
