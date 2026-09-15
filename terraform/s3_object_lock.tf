resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "evidence_vault" {
  bucket        = "${var.bucket_prefix}-${var.environment}-${random_id.bucket_suffix.hex}"
  force_destroy = false # Prevent accidental deletion of evidence bucket

  object_lock_enabled = true

  tags = {
    Name       = "response-desk-evidence-vault"
    Purpose    = "ForensicWORMStorage"
    Security   = "Strict-ObjectLock-Compliance"
    Compliance = "ITRules2021-DPDP2023"
  }
}

# 1. Enforce Bucket Versioning (Prerequisite for Object Lock)
resource "aws_s3_bucket_versioning" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 2. Enforce Strict Server-Side Encryption with Customer-Managed KMS Key
resource "aws_s3_bucket_server_side_encryption_configuration" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.evidence_cmk.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

# 3. Block All Public Access (Zero Public Leakage)
resource "aws_s3_bucket_public_access_block" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 4. Enforce WORM Object Lock Retention in COMPLIANCE Mode
resource "aws_s3_bucket_object_lock_configuration" "evidence_vault" {
  depends_on = [aws_s3_bucket_versioning.evidence_vault]
  bucket     = aws_s3_bucket.evidence_vault.id

  rule {
    default_retention {
      mode = "COMPLIANCE" # COMPLIANCE mode cannot be overwritten even by AWS root
      days = var.object_lock_retention_days
    }
  }
}

# 5. Bucket Security Policy: Require HTTPS & Enforce KMS Encryption
resource "aws_s3_bucket_policy" "evidence_vault_security" {
  bucket = aws_s3_bucket.evidence_vault.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceSecureTransportOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.evidence_vault.arn,
          "${aws_s3_bucket.evidence_vault.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
      {
        Sid       = "DenyUnencryptedObjectUploads"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.evidence_vault.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption" = "aws:kms"
          }
        }
      },
      {
        Sid       = "DenyWrongKmsKeyUploads"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.evidence_vault.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.evidence_cmk.arn
          }
        }
      }
    ]
  })
}
