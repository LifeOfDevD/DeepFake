# CLOUD-001: Production AWS Infrastructure Assurance Package

**Document ID:** CLOUD-001-SPEC-v1.0  
**Target Architecture:** AWS Cloud — Mumbai Region (`ap-south-1`)  
**Application:** Digital Impersonation Response Desk  
**Release Baseline:** `v1.0.0-controlled-pilot-rc2`  
**Current Assurance Status:** `OPEN / IAC_VERIFIED_PROVISIONING_PENDING`  
**General Availability Gate:** Hard Blocker (GA strictly withheld until live deployment verification)  

---

## 1. Executive Summary

This document establishes the infrastructure security and compliance assurance specification for **CLOUD-001 (Production AWS Infrastructure Assurance)**.

The Digital Impersonation Response Desk stores digital forensic evidence, evidentiary chain-of-custody ledgers, and takedown notices relating to cyber impersonation incidents. To comply with Indian statutory requirements—specifically the **Digital Personal Data Protection Act, 2023 (DPDP)** and the **Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 (IT Rules 2021)**—production evidence storage cannot rely on local non-WORM storage.

This assurance package verifies:
1. **India Data Residency:** Exclusively deployed in AWS `ap-south-1` (Mumbai).
2. **Hardware WORM Storage:** S3 Object Lock in strict `COMPLIANCE` mode with minimum 180-day retention.
3. **Cryptographic Protection:** Customer-Managed KMS Key (CMK) with annual rotation and explicit deletion denial.
4. **Least Privilege IAM:** Container execution role with cryptographic isolation and explicit deny on object deletion.
5. **Human Approval Gate:** Live cloud provisioning is gated behind authorized cloud credentials and explicit human sign-off.

---

## 2. Infrastructure as Code (IaC) Inspection

The codebase contains authoritative Terraform definitions under [`terraform/`](../../terraform) engineered specifically for production deployment.

### 2.1 Geographic Boundary & Residency (`terraform/main.tf`, `terraform/variables.tf`)

* **Mandated Region:** `ap-south-1` (Asia Pacific - Mumbai).
* **Validation Rule:**
  ```hcl
  variable "aws_region" {
    type        = string
    default     = "ap-south-1"
    validation {
      condition     = var.aws_region == "ap-south-1"
      error_message = "India DPDP Act and IT Rules residency mandates deployment in ap-south-1 (Mumbai)."
    }
  }
  ```
* **Assurance Finding:** Enforces single-region Indian jurisdiction. Cross-border replica configurations are disabled (`multi_region = false` on KMS key).

### 2.2 Customer-Managed KMS Key (`terraform/kms.tf`)

* **Resource:** `aws_kms_key.evidence_cmk`
* **Key Properties:**
  - `description`: "Customer-Managed Key (CMK) for Digital Impersonation Response Desk evidence encryption"
  - `deletion_window_in_days`: `30` (maximum non-expedited deletion buffer)
  - `enable_key_rotation`: `true` (automated 365-day rotation)
  - `multi_region`: `false` (prevents cross-border key copying)
* **Cryptographic Access Control:**
  - `AllowApplicationCryptographicOperations`: Grants `kms:GenerateDataKey`, `kms:GenerateDataKeyWithoutPlaintext`, `kms:Decrypt`, `kms:DescribeKey` to `aws_iam_role.app_role.arn`.
  - `ExplicitDenyKeyDestructionToApplicationRole`: Explicitly denies `kms:ScheduleKeyDeletion`, `kms:CancelKeyDeletion`, and `kms:DisableKey` to the application execution role.

### 2.3 S3 Evidence Vault with WORM Object Lock (`terraform/s3_object_lock.tf`)

* **Resource:** `aws_s3_bucket.evidence_vault`
* **Protection Configurations:**
  1. `force_destroy = false`: Terraform cannot destroy non-empty evidence buckets.
  2. `object_lock_enabled = true`: Immutable WORM storage configured at bucket creation.
  3. `aws_s3_bucket_versioning`: Enabled (unconditionally required for Object Lock).
  4. `aws_s3_bucket_server_side_encryption_configuration`: SSE-KMS using `aws_kms_key.evidence_cmk.arn` with `bucket_key_enabled = true`.
  5. `aws_s3_bucket_public_access_block`: All four blocks enabled (`block_public_acls`, `block_public_policy`, `ignore_public_acls`, `restrict_public_buckets`).
  6. `aws_s3_bucket_object_lock_configuration`:
     - `mode = "COMPLIANCE"`: Neither application roles nor AWS root account can overwrite or delete objects during the retention window.
     - `days = 180`: Matches statutory retention mandated by IT Rules 2021 Rule 3(1)(h).
  7. `aws_s3_bucket_policy`:
     - `EnforceSecureTransportOnly`: Rejects any HTTP/non-TLS traffic (`aws:SecureTransport == false`).
     - `DenyUnencryptedObjectUploads`: Denies `PutObject` unless encrypted with `aws:kms`.
     - `DenyWrongKmsKeyUploads`: Denies `PutObject` unless encrypted with the designated CMK.

### 2.4 Least Privilege IAM Role & Policy (`terraform/iam.tf`)

* **Execution Role:** `aws_iam_role.app_role` (`response-desk-app-execution-role-${var.environment}`)
* **Permitted Actions:**
  - `s3:ListBucket`, `s3:GetBucketLocation` on bucket ARN
  - `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:HeadObject`, `s3:PutObjectLegalHold`, `s3:GetObjectLegalHold` on bucket objects
  - KMS cryptographic operations on `aws_kms_key.evidence_cmk.arn`
* **Explicit Deny Statements:**
  ```json
  {
    "Sid": "ExplicitDenyEvidenceDeletionAndBypass",
    "Effect": "Deny",
    "Action": [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:BypassGovernanceRetention",
      "s3:PutBucketPolicy",
      "s3:DeleteBucketPolicy"
    ],
    "Resource": [
      "arn:aws:s3:::response-desk-evidence-vault-*",
      "arn:aws:s3:::response-desk-evidence-vault-*/*"
    ]
  }
  ```

---

## 3. Threat Modeling & Failure Scenario Mapping

| Threat Vector | Mitigation in IaC | Verification in Codebase |
|---|---|---|
| **Malicious insider attempts evidence deletion** | S3 Object Lock in COMPLIANCE mode + IAM Explicit Deny on `s3:DeleteObject` | Tested in `tests/storage/cloud-failure-scenarios.test.ts` (attempted deletion returns failure/denial) |
| **Ransomware attempts to bypass retention** | COMPLIANCE mode prevents bypass even with administrative credentials | S3 API rejects `BypassGovernanceRetention` |
| **KMS Key tampering or premature destruction** | 30-day deletion window + explicit deny on `kms:ScheduleKeyDeletion` | Key destruction requires out-of-band multi-party authorization |
| **Cross-border data replication** | `multi_region = false` on KMS key; bucket constrained to `ap-south-1` | Regional variable enforcement prevents multi-region replication |
| **Man-in-the-middle network interception** | Bucket policy `Deny` on non-TLS requests (`aws:SecureTransport: false`) | All SDK clients configure HTTPS endpoints exclusively |

---

## 4. Production Provisioning Procedure & Human Approval Gate

Execution of `terraform apply` in an enterprise AWS account is a production-altering activity requiring human authorization.

### 4.1 Prerequisites for Live Cloud Deployment
1. Target AWS Account provisioned within organizational AWS Organizations boundary.
2. IAM User / Role with permissions to provision KMS, S3, and IAM roles in `ap-south-1`.
3. S3 bucket and DynamoDB table for Terraform remote state locking configured (`terraform/main.tf`).
4. Human approval and provisioned credentials supplied to CI/CD pipeline or deployment engineer.

### 4.2 Step-by-Step Provisioning Runbook
```bash
# 1. Authenticate with AWS CLI
aws sts get-caller-identity

# 2. Initialize Terraform
cd terraform
terraform init

# 3. Perform Plan and Inspect Spec
terraform plan -out=production.tfplan

# 4. Review plan outputs for COMPLIANCE mode and ap-south-1
terraform show production.tfplan

# 5. Apply (REQUIRES HUMAN OPERATOR SIGN-OFF)
terraform apply production.tfplan

# 6. Capture outputs into production environment variables
export S3_EVIDENCE_BUCKET=$(terraform output -raw s3_bucket_id)
export KMS_KEY_ARN=$(terraform output -raw kms_cmk_arn)
export AWS_REGION=$(terraform output -raw aws_region)
```

---

## 5. Live Assurance Verification Checklist

To close `CLOUD-001` and allow GA promotion, an authorized cloud engineer must verify:

- [ ] `terraform apply` completed with 0 errors in target AWS account (`ap-south-1`).
- [ ] KMS Key ARN verified in AWS KMS Console, rotation flag set to `Enabled`.
- [ ] S3 Bucket created with Object Lock confirmed in AWS Console (`Mode: Compliance, Default: 180 Days`).
- [ ] Bucket Public Access Block confirmed (All 4 settings: `True`).
- [ ] Test object uploaded with KMS encryption and verified readable via presigned HMAC token.
- [ ] Test object deletion attempted by application role and confirmed rejected with `403 Forbidden` / `Access Denied`.
- [ ] CloudWatch Alarm configured for KMS key state changes and S3 bucket policy alterations.
- [ ] Formal signed Cloud Infrastructure Attestation recorded in `results/CLOUD-001_EVIDENCE.json`.

---

## 6. Current Assurance Determination

* **Static IaC Integrity:** **`PASS`** (All Terraform specifications verified; strict compliance with IT Rules 2021 and DPDP 2023).
* **Live Infrastructure Provisioning:** **`PENDING`** (Awaiting authorized AWS credentials and human sign-off).
* **CLOUD-001 Status:** **`OPEN`**
* **Impact on GA Gate:** **`HARD_BLOCKER`** (General Availability remains strictly withheld).
