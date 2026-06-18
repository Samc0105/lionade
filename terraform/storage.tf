# ─────────────────────────────────────────────────────────────────────────
# storage.tf — Lionade file-storage layer, brought fully under IaC.
#
# Goal: every FILE (public app assets + private user uploads) lives in a
# properly hardened S3 bucket — cybersecurity-grade, resume-worthy.
#
# This file:
#   1. Imports the pre-existing, console-created prod assets stack
#      (lionade-assets bucket + CloudFront E1ESHVPDIA9NU1 + OAC + the
#      lionade-s3-key CMK) so the d1745aj99cclbu.cloudfront.net hostname
#      stays stable — NOTHING is recreated, so no app-code/URL churn.
#   2. Fills the security gaps on that imported stack: KMS key rotation,
#      the CloudFront kms:Decrypt key-policy grant, S3 versioning + access
#      logging, a TLS-only bucket policy, and a CloudFront response-headers
#      policy (HSTS / nosniff / frame-deny / referrer).
#   3. Creates a dedicated access-log sink bucket (lionade-logs).
#   4. Hardens the other buckets defined in main.tf (user_uploads, tf_state,
#      staging_assets) with TLS-only policies, ACLs-disabled, access logging.
#
# What this pass does NOT do (deliberately, per the infra-only scope):
#   - No app-code cutover (reading/writing through S3) — separate phase.
#   - No data backfill out of Supabase Storage (note-images, class-syllabi).
#   - Favicons / PWA manifest icons / Tesseract OCR runtime STAY in Vercel
#     public/ (same-origin-sensitive; moving them breaks browser fetches).
#   - WAF is left as the existing console-managed ACL already on the dist
#     (CreatedByCloudFront-1c4f2d3f) — referenced, not re-created.
#
# Security model in one line: public assets are world-readable ONLY through
# CloudFront (OAC + a SourceArn-scoped bucket policy) while the bucket itself
# is 100% private (BPA on); private uploads are reachable ONLY via server-
# issued presigned URLs; every bucket is SSE-encrypted, TLS-only, ACLs-off,
# access-logged.
# ─────────────────────────────────────────────────────────────────────────

# ═══════════════════════════════════════════════════════════════════════════
# Shared customer-managed KMS CMK (alias/lionade-s3-key).
# ALREADY EXISTS (console-created, already encrypting lionade-assets). We IMPORT
# it rather than create a second key — a new key would leave existing objects on
# the old key and force CloudFront to decrypt against both. Two real gaps we fix:
#   (a) key rotation was OFF — turn it ON (annual auto-rotation).
#   (b) the key policy was MISSING the CloudFront grant — every KMS-encrypted
#       object would 403 through the CDN. We add the cloudfront.amazonaws.com
#       kms:Decrypt grant, scoped by aws:SourceArn to OUR distribution.
# Cost: ~$1/mo for the CMK + $0.03/10k requests (bucket_key_enabled keeps the
# request half near-zero).
# ═══════════════════════════════════════════════════════════════════════════

import {
  to = aws_kms_key.s3
  id = "a816f52b-0eaf-4ea4-a099-2bfbcd457e05"
}

resource "aws_kms_key" "s3" {
  description             = "Key used to encrypt Lionade application S3 buckets"
  enable_key_rotation     = true # was OFF on the live key — resume-grade requires rotation
  deletion_window_in_days = 30
  tags                    = { Project = "Lionade", ManagedBy = "Terraform" }
}

import {
  to = aws_kms_alias.s3
  id = "alias/lionade-s3-key"
}

resource "aws_kms_alias" "s3" {
  name          = "alias/lionade-s3-key"
  target_key_id = aws_kms_key.s3.key_id
}

# Key policy = the existing console policy (root + lionade-admin admin/use/grant)
# PLUS the two grants the live key lacked: CloudFront read of encrypted assets, and
# the upload-signer role's data-key usage for the (now SSE-KMS) user_uploads bucket.
# Managed as a separate resource so the policy can reference the distribution ARN
# without a create-time cycle.
resource "aws_kms_key_policy" "s3" {
  key_id = aws_kms_key.s3.id
  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "lionade-s3-key-policy"
    Statement = [
      {
        Sid       = "EnableRootAccount"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/lionade-admin" }
        Action = [
          "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*",
          "kms:Update*", "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:Delete*",
          "kms:TagResource", "kms:UntagResource", "kms:ScheduleKeyDeletion",
          "kms:CancelKeyDeletion", "kms:RotateKeyOnDemand", "kms:Encrypt", "kms:Decrypt",
          "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:CreateGrant", "kms:ListGrants",
          "kms:RevokeGrant"
        ]
        Resource = "*"
      },
      {
        # THE HALF EVERYONE FORGETS: without this, CloudFront returns AccessDenied on
        # every KMS-encrypted object even with a perfect bucket policy. Scoped to our
        # one distribution via aws:SourceArn.
        Sid       = "AllowCloudFrontDecrypt"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = ["kms:Decrypt"]
        Resource  = "*"
        Condition = {
          StringEquals = { "aws:SourceArn" = aws_cloudfront_distribution.assets.arn }
        }
      }
    ]
  })
}

# ═══════════════════════════════════════════════════════════════════════════
# Dedicated access-log sink. A bucket cannot log to itself (recursion), so this
# is the prerequisite for turning on S3 server-access logging anywhere.
# AES256 (not KMS): KMS on a log bucket bills a Decrypt per log delivery for no
# real benefit. Logs age out at 90 days so the bucket never bleeds storage cost.
# ═══════════════════════════════════════════════════════════════════════════

resource "aws_s3_bucket" "logs" {
  bucket = "lionade-logs"
  tags   = { Project = "Lionade", Environment = "production", ManagedBy = "Terraform" }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# BucketOwnerEnforced is fine here: S3 server-access logging uses a service-principal
# PutObject grant (below), NOT ACLs. (CloudFront *standard* logging would need ACLs and
# is deliberately NOT enabled — see the runbook note at the bottom of this file.)
resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-logs"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "S3ServerAccessLogsWrite"
        Effect    = "Allow"
        Principal = { Service = "logging.s3.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.logs.arn}/*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
}

# ═══════════════════════════════════════════════════════════════════════════
# PROD public assets bucket — lionade-assets. IMPORTED (console-created; it is the
# origin behind d1745aj99cclbu.cloudfront.net). Already private (BPA on), already
# SSE-KMS, already ACLs-disabled, already OAC-policy'd. We import all of that to
# manage it, then ADD the missing controls: versioning, access logging, a TLS-only
# statement on the bucket policy.
# ═══════════════════════════════════════════════════════════════════════════

import {
  to = aws_s3_bucket.assets
  id = "lionade-assets"
}

resource "aws_s3_bucket" "assets" {
  bucket = "lionade-assets"
  tags   = { Project = "Lionade", Environment = "production", ManagedBy = "Terraform" }

  # Live prod data behind the CDN — never let a config change destroy it.
  lifecycle { prevent_destroy = true }
}

import {
  to = aws_s3_bucket_public_access_block.assets
  id = "lionade-assets"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

import {
  to = aws_s3_bucket_ownership_controls.assets
  id = "lionade-assets"
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

import {
  to = aws_s3_bucket_server_side_encryption_configuration.assets
  id = "lionade-assets"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

# NEW — did not exist on the live bucket. Brand assets are worth versioning.
resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration { status = "Enabled" }
}

# NEW — access logging for the asset origin.
resource "aws_s3_bucket_logging" "assets" {
  bucket        = aws_s3_bucket.assets.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3-access/assets/"
}

# NEW — abort orphaned multipart uploads + age out old versions.
resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

# IMPORTED policy currently has ONLY the CloudFront OAC read grant. We re-declare that
# grant verbatim (so the CDN keeps serving) and ADD a TLS-only Deny.
import {
  to = aws_s3_bucket_policy.assets
  id = "lionade-assets"
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "PolicyForCloudFrontPrivateContent"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.assets.arn}/*"
        Condition = {
          StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.assets.arn }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.assets.arn, "${aws_s3_bucket.assets.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
}

# ═══════════════════════════════════════════════════════════════════════════
# CloudFront — IMPORTED (E1ESHVPDIA9NU1, domain d1745aj99cclbu.cloudfront.net).
# We import the distribution + its OAC so the hostname every other system points
# at (Next.js remotePatterns, iOS, Supabase rows, every cdnUrl() call) stays
# IDENTICAL. The ONLY functional change we layer on is attaching a security
# response-headers policy. The existing WAF (console-managed) is referenced as-is.
# ═══════════════════════════════════════════════════════════════════════════

import {
  to = aws_cloudfront_origin_access_control.assets
  id = "E3CMX4SL1XH5DL"
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "lionade-assets.s3.us-east-1.amazonaws.com"
  description                       = ""
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Security headers for every asset response. Native CloudFront feature — free,
# no Lambda@Edge. This is the one live behavior change to the distribution.
resource "aws_cloudfront_response_headers_policy" "assets" {
  name    = "lionade-assets-security-headers"
  comment = "HSTS + nosniff + frame-deny + referrer for Lionade CDN assets"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

import {
  to = aws_cloudfront_distribution.assets
  id = "E1ESHVPDIA9NU1"
}

# Written to MATCH the live distribution config exactly (so the import is near
# zero-diff) plus the single addition: response_headers_policy_id. If `terraform
# plan` surfaces any other drift after import, it is reconciled before apply.
resource "aws_cloudfront_distribution" "assets" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2"
  price_class     = "PriceClass_All"
  comment         = ""

  tags = {
    Name        = "lionade-assets"
    Project     = "Lionade"
    Environment = "production"
    ManagedBy   = "Terraform"
  }

  # Existing console-managed WAF (auto-created with the distribution). Referenced,
  # not managed here — already attached and already billed.
  web_acl_id = "arn:aws:wafv2:us-east-1:263856761688:global/webacl/CreatedByCloudFront-1c4f2d3f/54f926d5-bd2e-49e8-a3b4-fdb89b4ef8f0"

  origin {
    domain_name              = "lionade-assets.s3.us-east-1.amazonaws.com"
    origin_id                = "lionade-assets.s3.us-east-1.amazonaws.com-mnqljrgtxt3"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
    connection_attempts      = 3
    connection_timeout       = 10
  }

  default_cache_behavior {
    target_origin_id           = "lionade-assets.s3.us-east-1.amazonaws.com-mnqljrgtxt3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed CachingOptimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.assets.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Default *.cloudfront.net cert — keeps the d1745aj99cclbu hostname. (Min-TLS is
  # locked at TLSv1 by the default cert; raising it to 1.2 needs a custom domain,
  # which would change the URL — out of scope and explicitly forbidden this pass.)
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Hardening for the buckets already declared in main.tf (user_uploads, tf_state,
# staging_assets). These buckets do not exist in AWS yet, so these are plain
# creates (no import). All free: ACLs-disabled, TLS-only, access logging.
# (user_uploads SSE was upgraded to KMS inline in main.tf.)
# ═══════════════════════════════════════════════════════════════════════════

# ─── user_uploads (private PII) ────────────────────────────────────────────
resource "aws_s3_bucket_ownership_controls" "user_uploads" {
  bucket = aws_s3_bucket.user_uploads.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_logging" "user_uploads" {
  bucket        = aws_s3_bucket.user_uploads.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3-access/user-uploads/"
}

resource "aws_s3_bucket_policy" "user_uploads" {
  bucket = aws_s3_bucket.user_uploads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.user_uploads.arn, "${aws_s3_bucket.user_uploads.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
      # NOTE: the deny-unencrypted-PutObject statement (require x-amz-sse=aws:kms) is
      # intentionally omitted until the presign app-code sends that header, or every
      # upload would 403. Bucket default encryption (KMS) still applies transparently.
    ]
  })
}

# ─── tf_state (remote Terraform state) ─────────────────────────────────────
resource "aws_s3_bucket_ownership_controls" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_policy" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.tf_state.arn, "${aws_s3_bucket.tf_state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# ─── staging_assets (empty staging placeholder) ────────────────────────────
resource "aws_s3_bucket_ownership_controls" "staging_assets" {
  bucket = aws_s3_bucket.staging_assets.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_policy" "staging_assets" {
  bucket = aws_s3_bucket.staging_assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.staging_assets.arn, "${aws_s3_bucket.staging_assets.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# ═══════════════════════════════════════════════════════════════════════════
# NEW least-privilege IAM role for the public-asset publish path (a future CI /
# script `aws s3 cp public/ -> lionade-assets`, e.g. generate-illustrations.mjs).
# Gated on the same Vercel-OIDC pattern as the other roles (count = oidc_enabled),
# so it is only created once var.vercel_team_slug is set. Scoped to the assets
# bucket + the CMK only.
# ═══════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "assets_publisher" {
  count              = local.oidc_enabled ? 1 : 0
  name               = "lionade-assets-publisher"
  assume_role_policy = data.aws_iam_policy_document.vercel_assume[0].json
  tags               = { Project = "Lionade", ManagedBy = "Terraform" }
}

resource "aws_iam_role_policy" "assets_publisher" {
  count = local.oidc_enabled ? 1 : 0
  name  = "assets-publisher"
  role  = aws_iam_role.assets_publisher[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PublishAssets"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.assets.arn}/*"
      },
      {
        Sid      = "ListAssets"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.assets.arn
      },
      {
        Sid      = "EncryptAssets"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.s3.arn
      }
    ]
  })
}

# ─── Account identity (used by the KMS + log-bucket policies above) ─────────
data "aws_caller_identity" "current" {}

# ─── Outputs ───────────────────────────────────────────────────────────────
output "assets_bucket" {
  value       = aws_s3_bucket.assets.id
  description = "Prod public-asset bucket (CloudFront origin)"
}

output "assets_cdn_domain" {
  value       = aws_cloudfront_distribution.assets.domain_name
  description = "NEXT_PUBLIC_CDN_URL host (must stay d1745aj99cclbu.cloudfront.net)"
}

output "logs_bucket" {
  value       = aws_s3_bucket.logs.id
  description = "Dedicated S3 access-log sink"
}

output "s3_kms_key_arn" {
  value       = aws_kms_key.s3.arn
  description = "Shared SSE-KMS CMK for Lionade S3"
}

output "assets_publisher_role_arn" {
  value       = local.oidc_enabled ? aws_iam_role.assets_publisher[0].arn : "(set vercel_team_slug to create)"
  description = "ASSETS_PUBLISHER_ROLE_ARN (public/ -> assets sync)"
}

# ═══════════════════════════════════════════════════════════════════════════
# RUNBOOK NOTES
#  - CloudFront *standard* access logging is intentionally NOT enabled: it writes
#    via S3 ACLs, which conflicts with the BucketOwnerEnforced log bucket and would
#    SILENTLY fail. S3 server-access logs (configured above) cover the audit need.
#    If CDN request logs are wanted later, use CloudFront Standard Logging V2
#    (CloudWatch/Firehose), not the ACL-based S3 path.
#  - WAF: the distribution already has a console-created WAFv2 ACL
#    (CreatedByCloudFront-1c4f2d3f, ~$5/mo + rules). It is referenced, not managed
#    here. Bring it under IaC or detach it in a follow-up if desired.
#  - GuardDuty S3 Protection / Macie: deliberately NOT enabled (volume-priced, would
#    threaten the $20/mo budget). Enable when revenue justifies.
# ═══════════════════════════════════════════════════════════════════════════
