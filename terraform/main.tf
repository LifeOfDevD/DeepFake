terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Production backend configuration (S3 state locking via DynamoDB)
  # backend "s3" {
  #   bucket         = "response-desk-tfstate-ap-south-1"
  #   key            = "prod/response-desk.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "response-desk-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Digital Impersonation Response Desk"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Security    = "Strict-WORM-KMS"
      Compliance  = "DPDP-ITRules"
    }
  }
}
