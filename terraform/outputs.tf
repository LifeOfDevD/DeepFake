output "s3_bucket_id" {
  description = "The ID/Name of the S3 evidence vault bucket"
  value       = aws_s3_bucket.evidence_vault.id
}

output "s3_bucket_arn" {
  description = "The ARN of the S3 evidence vault bucket"
  value       = aws_s3_bucket.evidence_vault.arn
}

output "kms_cmk_arn" {
  description = "The ARN of the Customer-Managed KMS Key"
  value       = aws_kms_key.evidence_cmk.arn
}

output "kms_cmk_alias" {
  description = "The alias of the Customer-Managed KMS Key"
  value       = aws_kms_alias.evidence_cmk.name
}

output "iam_role_arn" {
  description = "The IAM Execution Role ARN for the application container"
  value       = aws_iam_role.app_role.arn
}

output "aws_region" {
  description = "The deployed AWS region (must be ap-south-1 for India Data Residency)"
  value       = var.aws_region
}
