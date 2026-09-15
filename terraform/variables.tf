variable "aws_region" {
  type        = string
  description = "AWS region for deployment (India Data Residency requirement: ap-south-1)"
  default     = "ap-south-1"

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "India DPDP Act and IT Rules residency mandates deployment in ap-south-1 (Mumbai)."
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment name (production or staging)"
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "Environment must be either 'production' or 'staging'."
  }
}

variable "bucket_prefix" {
  type        = string
  description = "Prefix for the S3 evidence vault bucket"
  default     = "response-desk-evidence-vault"
}

variable "kms_key_alias" {
  type        = string
  description = "Alias for the customer-managed KMS key"
  default     = "alias/response-desk-evidence-cmk"
}

variable "object_lock_retention_days" {
  type        = number
  description = "Default retention period in days for evidence items under Object Lock (IT Rules 2021 compliance)"
  default     = 180

  validation {
    condition     = var.object_lock_retention_days >= 180
    error_message = "IT Rules 2021 Rule 3(1)(h) requires evidence preservation for at least 180 days."
  }
}

variable "app_service_account_arn" {
  type        = string
  description = "Optional ARN of the ECS task execution role or EKS IAM service account principal"
  default     = ""
}
