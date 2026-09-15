import { describe, it, expect } from 'vitest';
import {
  processEvidenceStream,
  detectMimeTypeFromBytes,
  validateEvidenceFile,
  EvidenceValidationError
} from '../../src/services/evidence-hasher.js';

describe('Hasher & Validation: Cryptographic Integrity & Malware Guards', () => {
  // Synthetic file headers
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const pdfHeader = Buffer.from('%PDF-1.7\n%Test synthetic PDF header\n');

  it('calculates deterministic SHA-256 hashes and detects hash mutation', async () => {
    const fileA = Buffer.concat([pngHeader, Buffer.from('CONTENT_STREAM_ALPHA')]);
    const fileB = Buffer.concat([pngHeader, Buffer.from('CONTENT_STREAM_ALPHA')]);
    const fileC = Buffer.concat([pngHeader, Buffer.from('CONTENT_STREAM_BETA')]); // 1 byte diff

    const resA = await processEvidenceStream(fileA, 'image/png', 'screenshot_a.png');
    const resB = await processEvidenceStream(fileB, 'image/png', 'screenshot_b.png');
    const resC = await processEvidenceStream(fileC, 'image/png', 'screenshot_c.png');

    // Deterministic: Same input yields identical hash
    expect(resA.sha256).toBe(resB.sha256);
    expect(resA.sha256.length).toBe(64);

    // Mutation sensitivity: Changed bytes yield different hash
    expect(resA.sha256).not.toBe(resC.sha256);
  });

  it('detects MIME types from magic bytes rather than trusting client headers', () => {
    expect(detectMimeTypeFromBytes(pngHeader)).toBe('image/png');
    expect(detectMimeTypeFromBytes(jpegHeader)).toBe('image/jpeg');
    expect(detectMimeTypeFromBytes(pdfHeader)).toBe('application/pdf');
    expect(detectMimeTypeFromBytes(Buffer.from('Plain text operator evidence logs'))).toBe('text/plain');
  });

  it('strictly rejects Windows PE executables (.exe / MZ magic bytes)', () => {
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ header
    expect(() => detectMimeTypeFromBytes(exeBuffer)).toThrow(EvidenceValidationError);
    expect(() => detectMimeTypeFromBytes(exeBuffer)).toThrow(/Executable binaries/);
  });

  it('strictly rejects Linux ELF binaries', () => {
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]); // ELF header
    expect(() => detectMimeTypeFromBytes(elfBuffer)).toThrow(EvidenceValidationError);
    expect(() => detectMimeTypeFromBytes(elfBuffer)).toThrow(/Linux binary executables/);
  });

  it('strictly rejects shell scripts and batch files', () => {
    const bashScript = Buffer.from('#!/bin/bash\nrm -rf /');
    const batchScript = Buffer.from('@echo off\ndir');

    expect(() => detectMimeTypeFromBytes(bashScript)).toThrow(/Executable script files/);
    expect(() => detectMimeTypeFromBytes(batchScript)).toThrow(/Executable script files/);
  });

  it('rejects prohibited executable file extensions', () => {
    expect(() => {
      validateEvidenceFile('image/png', 'image/png', 1000, 'exploit.exe');
    }).toThrow(/File extension '\.exe' is prohibited/);

    expect(() => {
      validateEvidenceFile('image/png', 'image/png', 1000, 'script.ps1');
    }).toThrow(/File extension '\.ps1' is prohibited/);
  });

  it('detects and flags client MIME spoofing attempts', () => {
    // Declared as image/png, but bytes are plain text
    expect(() => {
      validateEvidenceFile('image/png', 'text/plain', 500, 'spoofed.png');
    }).toThrow(/MIME type mismatch detected/);
  });

  it('rejects empty (0-byte) files', () => {
    expect(() => {
      validateEvidenceFile('image/png', 'image/png', 0, 'empty.png');
    }).toThrow(/Empty file upload rejected/);
  });

  it('rejects oversized files exceeding category thresholds', () => {
    const oversizedImageBytes = 30 * 1024 * 1024; // 30 MB (limit is 25 MB)
    expect(() => {
      validateEvidenceFile('image/png', 'image/png', oversizedImageBytes, 'large.png');
    }).toThrow(/exceeds limit of 25 MB for image/);
  });
});
