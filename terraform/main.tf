# ─────────────────────────────────────────────────────────────────────────
# main.tf — Lionade infrastructure as code
#
# This file describes a single S3 bucket. Run `terraform apply` to create
# it. Run `terraform destroy` to delete it. Edit and re-apply to change.
# ─────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# ─── The bucket itself ────────────────────────────────────────────────────
resource "aws_s3_bucket" "staging_assets" {
  bucket = "lionade-assets-staging"

  tags = {
    Project     = "Lionade"
    Environment = "staging"
    ManagedBy   = "Terraform"
  }
}

# ─── Block all public access (security best practice) ───────────────────
resource "aws_s3_bucket_public_access_block" "staging_assets" {
  bucket = aws_s3_bucket.staging_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── Enable server-side encryption (free, AWS-managed keys) ─────────────
resource "aws_s3_bucket_server_side_encryption_configuration" "staging_assets" {
  bucket = aws_s3_bucket.staging_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ─── Enable versioning so deleted objects can be recovered ──────────────
resource "aws_s3_bucket_versioning" "staging_assets" {
  bucket = aws_s3_bucket.staging_assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ─── Outputs — values printed after apply ────────────────────────────────
output "bucket_name" {
  value       = aws_s3_bucket.staging_assets.id
  description = "The name of the staging bucket"
}

output "bucket_arn" {
  value       = aws_s3_bucket.staging_assets.arn
  description = "Full ARN of the bucket"
}

output "bucket_region" {
  value       = aws_s3_bucket.staging_assets.region
  description = "AWS region"
}
