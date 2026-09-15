data "aws_caller_identity" "current" {}

resource "aws_kms_key" "evidence_cmk" {
  description             = "Customer-Managed Key (CMK) for Digital Impersonation Response Desk evidence encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false # Enforces Indian data residency in ap-south-1

  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "response-desk-kms-policy"
    Statement = [
      {
        Sid    = "EnableRootIAMUserPermissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowApplicationCryptographicOperations"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.app_role.arn
        }
        Action = [
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = "*"
      },
      {
        Sid    = "ExplicitDenyKeyDestructionToApplicationRole"
        Effect = "Deny"
        Principal = {
          AWS = aws_iam_role.app_role.arn
        }
        Action = [
          "kms:ScheduleKeyDeletion",
          "kms:CancelKeyDeletion",
          "kms:DisableKey"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Name       = "response-desk-evidence-cmk"
    Purpose    = "EvidenceEncryption"
    DataClass  = "Confidential-Forensic"
    Compliance = "DPDP-ITRules"
  }
}

resource "aws_kms_alias" "evidence_cmk" {
  name          = var.kms_key_alias
  target_key_id = aws_kms_key.evidence_cmk.key_id
}
