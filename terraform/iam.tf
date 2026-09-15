resource "aws_iam_role" "app_role" {
  name = "response-desk-app-execution-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "response-desk-app-execution-role"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

resource "aws_iam_policy" "app_policy" {
  name        = "response-desk-storage-kms-least-privilege-${var.environment}"
  description = "Least privilege access policy for Response Desk application storage operations"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3EvidenceBucketList"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = aws_s3_bucket.evidence_vault.arn
      },
      {
        Sid    = "S3EvidenceObjectReadWrite"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:HeadObject",
          "s3:PutObjectLegalHold",
          "s3:GetObjectLegalHold"
        ]
        Resource = "${aws_s3_bucket.evidence_vault.arn}/*"
      },
      {
        Sid    = "ExplicitDenyEvidenceDeletionAndBypass"
        Effect = "Deny"
        Action = [
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:BypassGovernanceRetention",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy"
        ]
        Resource = [
          aws_s3_bucket.evidence_vault.arn,
          "${aws_s3_bucket.evidence_vault.arn}/*"
        ]
      },
      {
        Sid    = "KmsCryptographicOperations"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.evidence_cmk.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "app_policy_attach" {
  role       = aws_iam_role.app_role.name
  policy_arn = aws_iam_policy.app_policy.arn
}
