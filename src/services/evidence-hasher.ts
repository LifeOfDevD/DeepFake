import crypto from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';

export class EvidenceValidationError extends Error {
  constructor(message: string, public readonly code: string = 'EVIDENCE_VALIDATION_ERROR') {
    super(message);
    this.name = 'EvidenceValidationError';
  }
}

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'text/plain'
] as const;

export type SupportedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZES: Record<string, number> = {
  image: 25 * 1024 * 1024, // 25 MB
  audio: 100 * 1024 * 1024, // 100 MB
  video: 500 * 1024 * 1024, // 500 MB
  pdf: 50 * 1024 * 1024, // 50 MB
  text: 10 * 1024 * 1024 // 10 MB
};

export interface HashedEvidenceResult {
  sha256: string;
  byteSize: number;
  detectedMimeType: string;
  buffer: Buffer;
}

/**
 * Detects MIME type from file header magic bytes and flags dangerous executables.
 */
export function detectMimeTypeFromBytes(header: Buffer): string {
  if (!header || header.length === 0) {
    throw new EvidenceValidationError('Empty file stream received.', 'EMPTY_FILE');
  }

  // Dangerous executable rejection
  // 1. Windows PE / DOS Executable: MZ (0x4D 0x5A)
  if (header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a) {
    throw new EvidenceValidationError('Executable binaries (.exe / PE) are strictly prohibited.', 'EXECUTABLE_REJECTED');
  }

  // 2. Linux ELF: 0x7F 'E' 'L' 'F' (0x7F 0x45 0x4C 0x46)
  if (header.length >= 4 && header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
    throw new EvidenceValidationError('Linux binary executables (ELF) are strictly prohibited.', 'EXECUTABLE_REJECTED');
  }

  // 3. Mach-O (macOS): 0xFE 0xED 0xFA 0xCE or 0xCF 0xFA 0xED 0xFE
  if (header.length >= 4) {
    const magic32 = header.readUInt32BE(0);
    if (magic32 === 0xfeedface || magic32 === 0xcefaedfe || magic32 === 0xfeedfacf || magic32 === 0xcffaedfe) {
      throw new EvidenceValidationError('Mach-O binary executables are strictly prohibited.', 'EXECUTABLE_REJECTED');
    }
  }

  // 4. Script shebang / Windows batch: #! or @echo
  const headerText = header.subarray(0, 16).toString('ascii').toLowerCase();
  if (headerText.startsWith('#!') || headerText.startsWith('@echo off')) {
    throw new EvidenceValidationError('Executable script files are strictly prohibited.', 'EXECUTABLE_REJECTED');
  }

  // =========================================================================
  // ALLOWED MEDIA SIGNATURES
  // =========================================================================

  // JPEG: FF D8 FF
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return 'image/png';
  }

  // PDF: %PDF (25 50 44 46)
  if (header.length >= 4 && header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
    return 'application/pdf';
  }

  // WebP: RIFF ... WEBP (0x52 0x49 0x46 0x46 ... 0x57 0x45 0x42 0x50)
  if (header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }

  // WAV: RIFF ... WAVE
  if (header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'audio/wav';
  }

  // MP4: offset 4 'ftyp'
  if (header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'video/mp4';
  }

  // WebM: 1A 45 DF A3 (EBML header)
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
    return 'video/webm';
  }

  // MP3: ID3 tag or frame sync (0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2)
  if (header.length >= 3 && header.subarray(0, 3).toString('ascii') === 'ID3') {
    return 'audio/mpeg';
  }
  if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }

  // Plain text detection (check if initial bytes are valid printable ASCII or UTF-8)
  let isPrintable = true;
  for (let i = 0; i < Math.min(header.length, 512); i++) {
    const byte = header[i];
    // Allow tab (9), LF (10), CR (13), and printable characters (32..126)
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) {
      isPrintable = false;
      break;
    }
  }
  if (isPrintable) {
    return 'text/plain';
  }

  throw new EvidenceValidationError('Unsupported or unknown binary file format.', 'UNSUPPORTED_MEDIA_TYPE');
}

/**
 * Validates declared MIME type against detected MIME type and enforces file size limits.
 */
export function validateEvidenceFile(
  declaredMimeType: string,
  detectedMimeType: string,
  byteSize: number,
  originalFilename: string
): void {
  // Reject zero-byte files
  if (byteSize <= 0) {
    throw new EvidenceValidationError('Empty file upload rejected.', 'EMPTY_FILE');
  }

  // Dangerous file extension check
  const ext = originalFilename.split('.').pop()?.toLowerCase() || '';
  const prohibitedExtensions = ['exe', 'bat', 'cmd', 'ps1', 'sh', 'elf', 'dll', 'so', 'vbs', 'scr', 'jar', 'apk'];
  if (prohibitedExtensions.includes(ext)) {
    throw new EvidenceValidationError(`File extension '.${ext}' is prohibited.`, 'EXECUTABLE_REJECTED');
  }

  // Check against supported allowlist
  if (!ALLOWED_MIME_TYPES.includes(detectedMimeType as any)) {
    throw new EvidenceValidationError(
      `Detected file type '${detectedMimeType}' is not supported. Allowed types: [${ALLOWED_MIME_TYPES.join(', ')}]`,
      'UNSUPPORTED_MIME_TYPE'
    );
  }

  // MIME spoofing check: declared type cannot drastically conflict with detected type family
  const declaredFamily = declaredMimeType.split('/')[0];
  const detectedFamily = detectedMimeType.split('/')[0];
  if (declaredFamily !== detectedFamily && declaredMimeType !== 'application/octet-stream') {
    throw new EvidenceValidationError(
      `MIME type mismatch detected: Declared '${declaredMimeType}' but detected '${detectedMimeType}'.`,
      'MIME_MISMATCH'
    );
  }

  // Size limit check per category
  let category = detectedFamily;
  if (detectedMimeType === 'application/pdf') category = 'pdf';
  if (detectedMimeType === 'text/plain') category = 'text';

  const limit = MAX_FILE_SIZES[category] || 25 * 1024 * 1024;
  if (byteSize > limit) {
    const limitMB = Math.round(limit / (1024 * 1024));
    throw new EvidenceValidationError(
      `File size (${(byteSize / (1024 * 1024)).toFixed(1)} MB) exceeds limit of ${limitMB} MB for ${category}.`,
      'FILE_TOO_LARGE'
    );
  }
}

/**
 * Streams or processes buffer to calculate SHA-256 and detect MIME type.
 */
export async function processEvidenceStream(
  streamOrBuffer: Readable | Buffer,
  declaredMimeType: string,
  originalFilename: string
): Promise<HashedEvidenceResult> {
  const hash = crypto.createHash('sha256');
  let chunks: Buffer[] = [];
  let totalBytes = 0;

  if (Buffer.isBuffer(streamOrBuffer)) {
    totalBytes = streamOrBuffer.length;
    hash.update(streamOrBuffer);
    chunks = [streamOrBuffer];
  } else {
    for await (const chunk of streamOrBuffer) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > 500 * 1024 * 1024) {
        throw new EvidenceValidationError('File size exceeds maximum ceiling of 500 MB.', 'FILE_TOO_LARGE');
      }
      hash.update(buf);
      chunks.push(buf);
    }
  }

  const fullBuffer = Buffer.concat(chunks);
  const sha256 = hash.digest('hex');

  // Detect MIME type from the first 64 bytes
  const header = fullBuffer.subarray(0, 64);
  const detectedMimeType = detectMimeTypeFromBytes(header);

  // Validate limits and types
  validateEvidenceFile(declaredMimeType, detectedMimeType, totalBytes, originalFilename);

  return {
    sha256,
    byteSize: totalBytes,
    detectedMimeType,
    buffer: fullBuffer
  };
}

export interface HashedFileResult {
  sha256: string;
  byteSize: number;
  detectedMimeType: string;
  filePath: string;
}

/**
 * Processes an on-disk evidence file in a streaming fashion without loading the entire payload into memory.
 */
export async function processEvidenceFile(
  filePath: string,
  declaredMimeType: string,
  originalFilename: string
): Promise<HashedFileResult> {
  const stat = await fs.promises.stat(filePath);
  if (stat.size <= 0) {
    throw new EvidenceValidationError('Empty file upload rejected.', 'EMPTY_FILE');
  }

  // Check prohibited extensions first
  const ext = originalFilename.split('.').pop()?.toLowerCase() || '';
  const prohibitedExtensions = ['exe', 'bat', 'cmd', 'ps1', 'sh', 'elf', 'dll', 'so', 'vbs', 'scr', 'jar', 'apk'];
  if (prohibitedExtensions.includes(ext)) {
    throw new EvidenceValidationError(`File extension '.${ext}' is prohibited.`, 'EXECUTABLE_REJECTED');
  }

  // Sniff magic bytes from initial 512 bytes
  const fd = await fs.promises.open(filePath, 'r');
  const headerBuf = Buffer.alloc(Math.min(stat.size, 512));
  await fd.read(headerBuf, 0, headerBuf.length, 0);
  await fd.close();

  const detectedMimeType = detectMimeTypeFromBytes(headerBuf);

  // Validate limits against category
  validateEvidenceFile(declaredMimeType, detectedMimeType, stat.size, originalFilename);

  // Stream SHA-256 calculation
  const hash = crypto.createHash('sha256');
  const readStream = fs.createReadStream(filePath);
  for await (const chunk of readStream) {
    hash.update(chunk);
  }
  const sha256 = hash.digest('hex');

  return {
    sha256,
    byteSize: stat.size,
    detectedMimeType,
    filePath
  };
}


/**
 * Internal evidence scanning abstraction (stub for future antivirus/malware scanners).
 * Never calls external APIs or cloud providers in Phase 2.
 */
export interface EvidenceScannerResult {
  clean: boolean;
  threatDetails?: string;
}

export interface EvidenceScanner {
  scan(buffer: Buffer, originalFilename: string): Promise<EvidenceScannerResult>;
}

export class DefaultInternalScanner implements EvidenceScanner {
  public async scan(_buffer: Buffer, _originalFilename: string): Promise<EvidenceScannerResult> {
    // Hermetic internal check; does not invoke external network
    return { clean: true };
  }
}
