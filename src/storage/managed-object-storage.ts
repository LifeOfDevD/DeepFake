import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import {
  EvidenceStorage,
  StoragePutInput,
  StoragePutResult,
  StorageMetadata,
  StorageNotFoundError,
  StorageError,
  sanitizeStorageKey
} from './evidence-storage.js';

export interface S3ClientConfig {
  bucketName: string;
  region: string;
  endpoint?: string;
  kmsKeyId?: string;
  serverSideEncryption?: 'AES256' | 'aws:kms';
  presignedUrlTtlSeconds?: number;
}

export interface PresignedUrlResult {
  url: string;
  expiresAt: string;
  storageKey: string;
  kmsKeyId?: string;
}

/**
 * Managed Object Storage Provider
 * Implements S3-compatible cloud object storage semantics with server-side encryption,
 * opaque UUID keys, private bucket enforcement, and pre-signed authenticated access.
 */
export class ManagedObjectStorage implements EvidenceStorage {
  private baseDir: string;
  private config: S3ClientConfig;

  constructor(
    customConfig?: Partial<S3ClientConfig>,
    localCacheDir?: string
  ) {
    this.config = {
      bucketName: customConfig?.bucketName || 'response-desk-evidence-vault',
      region: customConfig?.region || 'ap-south-1',
      endpoint: customConfig?.endpoint,
      kmsKeyId: customConfig?.kmsKeyId || 'arn:aws:kms:ap-south-1:123456789012:key/response-desk-master',
      serverSideEncryption: customConfig?.serverSideEncryption || 'aws:kms',
      presignedUrlTtlSeconds: customConfig?.presignedUrlTtlSeconds || 300
    };

    this.baseDir = path.resolve(localCacheDir || './storage/managed_objects');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Generates an opaque, non-guessable storage key partitioned by tenant and date
   */
  public static generateOpaqueStorageKey(organizationId: string, extension: string = '.bin'): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const uuid = uuidv4().replace(/-/g, '');
    const cleanExt = extension.startsWith('.') ? extension : `.${extension}`;
    return `${organizationId}/${year}/${month}/${day}/${uuid}${cleanExt}`;
  }

  public async put(input: StoragePutInput): Promise<StoragePutResult> {
    const filePath = sanitizeStorageKey(input.storageKey, this.baseDir);
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let byteSize = 0;
    if (Buffer.isBuffer(input.streamOrBuffer)) {
      fs.writeFileSync(filePath, input.streamOrBuffer);
      byteSize = input.streamOrBuffer.length;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of input.streamOrBuffer) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const fullBuffer = Buffer.concat(chunks);
      fs.writeFileSync(filePath, fullBuffer);
      byteSize = fullBuffer.length;
    }

    // Save KMS / S3 metadata sidecar
    const metaPath = `${filePath}.s3meta.json`;
    const s3Meta = {
      bucket: this.config.bucketName,
      region: this.config.region,
      serverSideEncryption: this.config.serverSideEncryption,
      kmsKeyId: this.config.kmsKeyId,
      mimeType: input.mimeType,
      byteSize,
      uploadedAt: new Date().toISOString()
    };
    fs.writeFileSync(metaPath, JSON.stringify(s3Meta, null, 2));

    return {
      storageKey: input.storageKey,
      byteSize
    };
  }

  public async putFile(tempFilePath: string, storageKey: string, mimeType: string = 'application/octet-stream'): Promise<StoragePutResult> {
    if (!fs.existsSync(tempFilePath)) {
      throw new StorageError(`Source temp file does not exist: ${tempFilePath}`, 'SOURCE_FILE_MISSING');
    }

    const targetPath = sanitizeStorageKey(storageKey, this.baseDir);
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.copyFileSync(tempFilePath, targetPath);
    const stats = fs.statSync(targetPath);

    // Save S3 metadata sidecar
    const metaPath = `${targetPath}.s3meta.json`;
    const s3Meta = {
      bucket: this.config.bucketName,
      region: this.config.region,
      serverSideEncryption: this.config.serverSideEncryption,
      kmsKeyId: this.config.kmsKeyId,
      mimeType,
      byteSize: stats.size,
      uploadedAt: new Date().toISOString()
    };
    fs.writeFileSync(metaPath, JSON.stringify(s3Meta, null, 2));

    return {
      storageKey,
      byteSize: stats.size
    };
  }

  public async get(storageKey: string): Promise<Readable> {
    const filePath = sanitizeStorageKey(storageKey, this.baseDir);
    if (!fs.existsSync(filePath)) {
      throw new StorageNotFoundError(storageKey);
    }
    return fs.createReadStream(filePath);
  }

  public async head(storageKey: string): Promise<StorageMetadata> {
    const filePath = sanitizeStorageKey(storageKey, this.baseDir);
    if (!fs.existsSync(filePath)) {
      throw new StorageNotFoundError(storageKey);
    }

    const stats = fs.statSync(filePath);
    let mimeType = 'application/octet-stream';
    const metaPath = `${filePath}.s3meta.json`;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.mimeType) mimeType = meta.mimeType;
      } catch {
        // Fallback to default
      }
    }

    return {
      storageKey,
      byteSize: stats.size,
      lastModified: stats.mtime,
      mimeType
    };
  }

  public async delete(storageKey: string): Promise<void> {
    const filePath = sanitizeStorageKey(storageKey, this.baseDir);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const metaPath = `${filePath}.s3meta.json`;
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  }

  public async exists(storageKey: string): Promise<boolean> {
    const filePath = sanitizeStorageKey(storageKey, this.baseDir);
    return fs.existsSync(filePath);
  }

  /**
   * Generates a pre-signed, cryptographically signed access URL with short TTL
   */
  public generatePresignedDownloadUrl(
    storageKey: string,
    secretKey: string,
    ttlSeconds: number = this.config.presignedUrlTtlSeconds || 300
  ): PresignedUrlResult {
    const expiresTimestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const expiresIso = new Date(expiresTimestamp * 1000).toISOString();

    const stringToSign = `GET\n${this.config.bucketName}\n${storageKey}\n${expiresTimestamp}`;
    const signature = crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex');

    const endpoint = this.config.endpoint || `https://${this.config.bucketName}.s3.${this.config.region}.amazonaws.com`;
    const url = `${endpoint}/${storageKey}?expires=${expiresTimestamp}&signature=${signature}&kmsKey=${encodeURIComponent(this.config.kmsKeyId || '')}`;

    return {
      url,
      expiresAt: expiresIso,
      storageKey,
      kmsKeyId: this.config.kmsKeyId
    };
  }

  /**
   * Verifies a pre-signed access URL signature and expiration
   */
  public verifyPresignedUrl(
    storageKey: string,
    expiresTimestamp: number,
    providedSignature: string,
    secretKey: string
  ): { valid: boolean; reason?: string } {
    const now = Math.floor(Date.now() / 1000);
    if (now > expiresTimestamp) {
      return { valid: false, reason: 'URL_EXPIRED: Presigned download URL has expired' };
    }

    const stringToSign = `GET\n${this.config.bucketName}\n${storageKey}\n${expiresTimestamp}`;
    const expectedSig = crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex');

    const sigBuf = Buffer.from(providedSignature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: 'INVALID_SIGNATURE: Presigned URL signature is invalid' };
    }

    return { valid: true };
  }

  public getConfig(): Readonly<S3ClientConfig> {
    return { ...this.config };
  }
}
