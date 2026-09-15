import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config/env.js';

export class StorageError extends Error {
  constructor(message: string, public readonly code: string = 'STORAGE_ERROR') {
    super(message);
    this.name = 'StorageError';
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(storageKey: string) {
    super(`Storage object not found for key: '${storageKey}'`, 'STORAGE_NOT_FOUND');
    this.name = 'StorageNotFoundError';
  }
}

export class PathTraversalError extends StorageError {
  constructor(maliciousKey: string) {
    super(`Illegal path traversal detected in storage key: '${maliciousKey}'`, 'PATH_TRAVERSAL_DETECTED');
    this.name = 'PathTraversalError';
  }
}

export interface StoragePutInput {
  storageKey: string;
  streamOrBuffer: Readable | Buffer;
  byteSize?: number;
  mimeType: string;
}

export interface StoragePutResult {
  storageKey: string;
  byteSize: number;
}

export interface StorageMetadata {
  storageKey: string;
  byteSize: number;
  lastModified: Date;
  mimeType?: string;
}

export interface EvidenceStorage {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  putFile(tempFilePath: string, storageKey: string, mimeType?: string): Promise<StoragePutResult>;
  get(storageKey: string): Promise<Readable>;
  head(storageKey: string): Promise<StorageMetadata>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}


/**
 * Validates and normalizes storage keys, preventing path traversal.
 */
export function sanitizeStorageKey(storageKey: string, baseDir: string): string {
  if (!storageKey || typeof storageKey !== 'string') {
    throw new StorageError('Invalid storage key provided.', 'INVALID_STORAGE_KEY');
  }

  // Reject null bytes
  if (storageKey.includes('\0')) {
    throw new PathTraversalError(storageKey);
  }

  // Normalize forward and back slashes
  const normalizedKey = storageKey.replace(/\\/g, '/');

  // Check for directory traversal sequences
  const segments = normalizedKey.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new PathTraversalError(storageKey);
    }
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, normalizedKey);

  // Enforce boundary containment
  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    throw new PathTraversalError(storageKey);
  }

  return resolvedTarget;
}

/**
 * Local disk implementation storing evidence segregated outside public web roots.
 */
export class LocalEvidenceStorage implements EvidenceStorage {
  private baseDir: string;

  constructor(customBaseDir?: string) {
    const raw = customBaseDir || getConfig().storage.evidenceDir;
    this.baseDir = path.resolve(process.cwd(), raw);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public async put(input: StoragePutInput): Promise<StoragePutResult> {
    const targetPath = sanitizeStorageKey(input.storageKey, this.baseDir);
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Atomic write via temporary file rename
    const tempPath = `${targetPath}.${uuidv4()}.tmp`;

    try {
      if (Buffer.isBuffer(input.streamOrBuffer)) {
        await fs.promises.writeFile(tempPath, input.streamOrBuffer);
      } else {
        const writeStream = fs.createWriteStream(tempPath);
        await pipeline(input.streamOrBuffer, writeStream);
      }

      await fs.promises.rename(tempPath, targetPath);
      const stat = await fs.promises.stat(targetPath);

      return {
        storageKey: input.storageKey,
        byteSize: stat.size
      };
    } catch (err: any) {
      if (fs.existsSync(tempPath)) {
        try {
          await fs.promises.unlink(tempPath);
        } catch {}
      }
      throw new StorageError(`Failed to persist storage object: ${err.message}`, 'WRITE_FAILED');
    }
  }

  public async putFile(tempFilePath: string, storageKey: string, _mimeType?: string): Promise<StoragePutResult> {
    const targetPath = sanitizeStorageKey(storageKey, this.baseDir);
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      try {
        await fs.promises.rename(tempFilePath, targetPath);
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          await fs.promises.copyFile(tempFilePath, targetPath);
          await fs.promises.unlink(tempFilePath).catch(() => {});
        } else {
          throw err;
        }
      }

      const stat = await fs.promises.stat(targetPath);
      return {
        storageKey,
        byteSize: stat.size
      };
    } catch (err: any) {
      throw new StorageError(`Failed to persist storage file: ${err.message}`, 'WRITE_FAILED');
    }
  }

  public async get(storageKey: string): Promise<Readable> {
    const targetPath = sanitizeStorageKey(storageKey, this.baseDir);
    if (!fs.existsSync(targetPath)) {
      throw new StorageNotFoundError(storageKey);
    }
    return fs.createReadStream(targetPath);
  }

  public async head(storageKey: string): Promise<StorageMetadata> {
    const targetPath = sanitizeStorageKey(storageKey, this.baseDir);
    try {
      const stat = await fs.promises.stat(targetPath);
      return {
        storageKey,
        byteSize: stat.size,
        lastModified: stat.mtime
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new StorageNotFoundError(storageKey);
      }
      throw new StorageError(err.message);
    }
  }

  public async delete(storageKey: string): Promise<void> {
    const targetPath = sanitizeStorageKey(storageKey, this.baseDir);
    if (fs.existsSync(targetPath)) {
      try {
        await fs.promises.unlink(targetPath);
      } catch (err: any) {
        throw new StorageError(`Failed to delete storage object: ${err.message}`, 'DELETE_FAILED');
      }
    }
  }

  public async exists(storageKey: string): Promise<boolean> {
    try {
      const targetPath = sanitizeStorageKey(storageKey, this.baseDir);
      return fs.existsSync(targetPath);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        throw err;
      }
      return false;
    }
  }
}

/**
 * In-memory storage provider for hermetic, fast test suites.
 */
export class InMemoryEvidenceStorage implements EvidenceStorage {
  private objects: Map<string, { buffer: Buffer; metadata: StorageMetadata }> = new Map();
  private baseVirtualDir = 'evidence';

  public async put(input: StoragePutInput): Promise<StoragePutResult> {
    // Validate traversal semantics even in memory
    sanitizeStorageKey(input.storageKey, this.baseVirtualDir);

    let buf: Buffer;
    if (Buffer.isBuffer(input.streamOrBuffer)) {
      buf = input.streamOrBuffer;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of input.streamOrBuffer) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buf = Buffer.concat(chunks);
    }

    const metadata: StorageMetadata = {
      storageKey: input.storageKey,
      byteSize: buf.length,
      lastModified: new Date(),
      mimeType: input.mimeType
    };

    this.objects.set(input.storageKey, { buffer: buf, metadata });

    return {
      storageKey: input.storageKey,
      byteSize: buf.length
    };
  }

  public async putFile(tempFilePath: string, storageKey: string, mimeType: string = 'application/octet-stream'): Promise<StoragePutResult> {
    sanitizeStorageKey(storageKey, this.baseVirtualDir);
    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(tempFilePath);
    } catch {
      buf = Buffer.alloc(0);
    }

    const metadata: StorageMetadata = {
      storageKey,
      byteSize: buf.length,
      lastModified: new Date(),
      mimeType
    };

    this.objects.set(storageKey, { buffer: buf, metadata });
    return {
      storageKey,
      byteSize: buf.length
    };
  }

  public async get(storageKey: string): Promise<Readable> {
    sanitizeStorageKey(storageKey, this.baseVirtualDir);
    const item = this.objects.get(storageKey);
    if (!item) {
      throw new StorageNotFoundError(storageKey);
    }
    return Readable.from(item.buffer);
  }

  public async head(storageKey: string): Promise<StorageMetadata> {
    sanitizeStorageKey(storageKey, this.baseVirtualDir);
    const item = this.objects.get(storageKey);
    if (!item) {
      throw new StorageNotFoundError(storageKey);
    }
    return item.metadata;
  }

  public async delete(storageKey: string): Promise<void> {
    sanitizeStorageKey(storageKey, this.baseVirtualDir);
    this.objects.delete(storageKey);
  }

  public async exists(storageKey: string): Promise<boolean> {
    try {
      sanitizeStorageKey(storageKey, this.baseVirtualDir);
      return this.objects.has(storageKey);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        throw err;
      }
      return false;
    }
  }

  public clear(): void {
    this.objects.clear();
  }
}
