# ─────────────────────────────────────────────────────────────────────────
# main.tf — Lionade infrastructure as code
#
# Manages: the staging assets bucket, and the private user-uploads bucket +
# split IAM principals for the note-images upload pilot
# (docs/specs/note-images-s3-pilot.md). Run `terraform plan` to preview,
# `terraform apply` to create. NOTE: applying creates real AWS resources and
# emits IAM access keys (sensitive outputs) to copy into Vercel env.
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

# ═══════════════════════════════════════════════════════════════════════════
# User-uploads pilot — private bucket for note-image (and future) uploads.
# Spec: docs/specs/note-images-s3-pilot.md. The app uses presigned POST/GET so
# the bucket stays fully private (Block Public Access on). NEW bucket — does not
# touch the existing prod assets bucket / CloudFront.
# ═══════════════════════════════════════════════════════════════════════════

resource "aws_s3_bucket" "user_uploads" {
  bucket = "lionade-user-uploads"

  tags = {
    Project     = "Lionade"
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}

resource "aws_s3_bucket_public_access_block" "user_uploads" {
  bucket = aws_s3_bucket.user_uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "user_uploads" {
  bucket = aws_s3_bucket.user_uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "user_uploads" {
  bucket = aws_s3_bucket.user_uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "user_uploads" {
  bucket = aws_s3_bucket.user_uploads.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {} # whole bucket
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {} # whole bucket
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# CORS — presigned POST (upload) + GET (read) from the prod web origin ONLY.
# CORS does not authorize (the presigned signature does); keeping prod tight is free.
resource "aws_s3_bucket_cors_configuration" "user_uploads" {
  bucket = aws_s3_bucket.user_uploads.id

  cors_rule {
    allowed_methods = ["POST", "GET"]
    allowed_origins = ["https://getlionade.com"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# ─── IAM: request-path principal — PutObject + GetObject ONLY ──────────────
# Keys live in Vercel env and serve the presign / sign-read routes. A leak of
# these (the most-exposed keys) cannot list or delete anyone's objects.
resource "aws_iam_user" "uploads_web" {
  name = "lionade-user-uploads-web"
  tags = { Project = "Lionade", ManagedBy = "Terraform" }
}

resource "aws_iam_user_policy" "uploads_web" {
  name = "user-uploads-web"
  user = aws_iam_user.uploads_web.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "PutGetOnly"
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject"]
      Resource = "${aws_s3_bucket.user_uploads.arn}/*"
    }]
  })
}

resource "aws_iam_access_key" "uploads_web" {
  user = aws_iam_user.uploads_web.name
}

# ─── IAM: reaper principal — ListBucket + DeleteObject (+ versions) ────────
# Used ONLY by the account-deletion cron to purge a deleted user's prefix.
resource "aws_iam_user" "uploads_reaper" {
  name = "lionade-user-uploads-reaper"
  tags = { Project = "Lionade", ManagedBy = "Terraform" }
}

resource "aws_iam_user_policy" "uploads_reaper" {
  name = "user-uploads-reaper"
  user = aws_iam_user.uploads_reaper.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListForPurge"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketVersions"]
        Resource = aws_s3_bucket.user_uploads.arn
      },
      {
        Sid      = "DeleteForPurge"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = "${aws_s3_bucket.user_uploads.arn}/*"
      }
    ]
  })
}

resource "aws_iam_access_key" "uploads_reaper" {
  user = aws_iam_user.uploads_reaper.name
}

# ─── Outputs — copy into Vercel env after apply (secrets are sensitive) ────
output "user_uploads_bucket" {
  value       = aws_s3_bucket.user_uploads.id
  description = "USER_UPLOADS_BUCKET"
}

output "uploads_web_access_key_id" {
  value       = aws_iam_access_key.uploads_web.id
  description = "AWS_ACCESS_KEY_ID (request-path: presign + sign-read)"
}

output "uploads_web_secret_access_key" {
  value       = aws_iam_access_key.uploads_web.secret
  description = "AWS_SECRET_ACCESS_KEY (request-path)"
  sensitive   = true
}

output "uploads_reaper_access_key_id" {
  value       = aws_iam_access_key.uploads_reaper.id
  description = "UPLOADS_REAPER_ACCESS_KEY_ID (cron purge)"
}

output "uploads_reaper_secret_access_key" {
  value       = aws_iam_access_key.uploads_reaper.secret
  description = "UPLOADS_REAPER_SECRET_ACCESS_KEY (cron purge)"
  sensitive   = true
}
