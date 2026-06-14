# ─────────────────────────────────────────────────────────────────────────
# main.tf — Lionade infrastructure as code
#
# Manages: the staging assets bucket; the private user-uploads bucket (note-
# images pilot); AWS cost guardrails + remote Terraform state; and the cron
# dead-man's-switch (CloudWatch alarms -> SNS). AWS access is KEYLESS: the app
# assumes scoped IAM roles via Vercel OIDC, so no static AWS key lives in env.
#
# Activation is staged + variable-gated so steps can apply independently:
#   - vercel_team_slug = ""  -> OIDC provider + roles are skipped (apply the
#     cost guardrails / state / buckets without Vercel details).
#   - set vercel_team_slug   -> creates the OIDC provider + the 3 roles.
#   - enable_cron_alarms = true -> creates the alarms (ONLY after heartbeats are
#     confirmed flowing, else treat_missing_data=breaching fires immediately).
# Run `terraform plan` to preview, `terraform apply` to create.
# ─────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
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

# ═══════════════════════════════════════════════════════════════════════════
# Keyless AWS access via Vercel OIDC. The app assumes scoped IAM ROLES using the
# runtime OIDC token Vercel injects (no static keys in env). One OIDC provider;
# three least-privilege roles (uploads-web, uploads-reaper, cron-heartbeat).
#
# RUNBOOK: set var.vercel_team_slug (+ project/env) to create these. Confirm the
# aud/sub format in Vercel > Project > Settings > OIDC matches the assume-role
# conditions below (Vercel uses aud=https://vercel.com/<team>,
# sub=owner:<team>:project:<project>:environment:<env>). Enable OIDC for the
# project, then set each role-ARN output as a Vercel env var to activate that
# feature. The live OIDC handshake is validated by Sam at activation.
# ═══════════════════════════════════════════════════════════════════════════

variable "vercel_team_slug" {
  type        = string
  default     = ""
  description = "Vercel team slug (from the dashboard URL). Empty = skip OIDC roles."
}

variable "vercel_project_name" {
  type        = string
  default     = "lionade"
  description = "Vercel project name, used in the OIDC sub-claim scope."
}

variable "oidc_environment" {
  type        = string
  default     = "production"
  description = "Vercel environment the roles trust (production|preview|development)."
}

locals {
  oidc_enabled = var.vercel_team_slug != ""
}

# Fetch the OIDC issuer's CA thumbprint dynamically (don't hardcode it).
data "tls_certificate" "vercel_oidc" {
  count = local.oidc_enabled ? 1 : 0
  url   = "https://oidc.vercel.com/${var.vercel_team_slug}/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "vercel" {
  count           = local.oidc_enabled ? 1 : 0
  url             = "https://oidc.vercel.com/${var.vercel_team_slug}"
  client_id_list  = ["https://vercel.com/${var.vercel_team_slug}"]
  thumbprint_list = [data.tls_certificate.vercel_oidc[0].certificates[0].sha1_fingerprint]
  tags            = { Project = "Lionade", ManagedBy = "Terraform" }
}

# Shared trust: only the Lionade Vercel project + environment may assume the roles.
data "aws_iam_policy_document" "vercel_assume" {
  count = local.oidc_enabled ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.vercel[0].arn]
    }

    condition {
      test     = "StringEquals"
      variable = "oidc.vercel.com/${var.vercel_team_slug}:aud"
      values   = ["https://vercel.com/${var.vercel_team_slug}"]
    }

    condition {
      test     = "StringEquals"
      variable = "oidc.vercel.com/${var.vercel_team_slug}:sub"
      values   = ["owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:${var.oidc_environment}"]
    }
  }
}

# ─── Role: request-path — PutObject + GetObject ONLY ───────────────────────
resource "aws_iam_role" "uploads_web" {
  count              = local.oidc_enabled ? 1 : 0
  name               = "lionade-uploads-web"
  assume_role_policy = data.aws_iam_policy_document.vercel_assume[0].json
  tags               = { Project = "Lionade", ManagedBy = "Terraform" }
}

resource "aws_iam_role_policy" "uploads_web" {
  count = local.oidc_enabled ? 1 : 0
  name  = "user-uploads-web"
  role  = aws_iam_role.uploads_web[0].id
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

# ─── Role: reaper — ListBucket + DeleteObject (cron purge only) ────────────
resource "aws_iam_role" "uploads_reaper" {
  count              = local.oidc_enabled ? 1 : 0
  name               = "lionade-uploads-reaper"
  assume_role_policy = data.aws_iam_policy_document.vercel_assume[0].json
  tags               = { Project = "Lionade", ManagedBy = "Terraform" }
}

resource "aws_iam_role_policy" "uploads_reaper" {
  count = local.oidc_enabled ? 1 : 0
  name  = "user-uploads-reaper"
  role  = aws_iam_role.uploads_reaper[0].id
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

# ─── Role: cron heartbeat — cloudwatch:PutMetricData (one namespace) ───────
resource "aws_iam_role" "cron_heartbeat" {
  count              = local.oidc_enabled ? 1 : 0
  name               = "lionade-cron-heartbeat"
  assume_role_policy = data.aws_iam_policy_document.vercel_assume[0].json
  tags               = { Project = "Lionade", ManagedBy = "Terraform" }
}

resource "aws_iam_role_policy" "cron_heartbeat" {
  count = local.oidc_enabled ? 1 : 0
  name  = "cron-heartbeat"
  role  = aws_iam_role.cron_heartbeat[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "PutCronHeartbeat"
      Effect   = "Allow"
      Action   = "cloudwatch:PutMetricData"
      Resource = "*"
      Condition = {
        StringEquals = { "cloudwatch:namespace" = "Lionade/Crons" }
      }
    }]
  })
}

# ═══════════════════════════════════════════════════════════════════════════
# Cron dead-man's-switch. Each Vercel cron emits Lionade/Crons -> Heartbeat on a
# successful run (lib/cloudwatch.ts). Alarms fire to SNS when a heartbeat goes
# missing (treat_missing_data = breaching), surfacing a silently-failing cron
# (the GDPR purge, plan-grant expiry, ...). The SNS topic is created up front;
# the ALARMS are gated on enable_cron_alarms so they're only created AFTER
# heartbeats are confirmed flowing (else they'd fire immediately).
# ═══════════════════════════════════════════════════════════════════════════

variable "enable_cron_alarms" {
  type        = bool
  default     = false
  description = "Create the cron alarms. Turn on ONLY after you have confirmed at least one Lionade/Crons Heartbeat datapoint for EVERY job in the trailing 8 days (CloudWatch console, namespace Lionade/Crons). The weekly academia-digest needs one Monday run to exist first; a daily cron emitting does NOT populate the weekly dimension. Flipping early makes that one alarm fire breaching on apply (auto-resolves next Monday). treat_missing_data=breaching fires immediately on any missing dimension."
}

resource "aws_sns_topic" "ops_alerts" {
  name = "lionade-ops-alerts"
  tags = { Project = "Lionade", ManagedBy = "Terraform" }
}

# RUNBOOK (one-time, on FIRST apply): AWS SNS email subscriptions are double
# opt-in. This resource creates in "PendingConfirmation" and delivers NOTHING
# until you click the confirm link AWS emails to alert_email (check spam; the
# link expires in ~3 days). Unlike the Budgets / Cost-Anomaly emails above
# (which need no confirmation), an unconfirmed topic means every alarm action
# silently no-ops, so the dead-man's switch would itself fail silently. Confirm
# in the SNS console > Subscriptions at first apply, BEFORE enable_cron_alarms.
resource "aws_sns_topic_subscription" "ops_alerts_email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# evaluation_periods are 1-DAY periods. Daily crons alarm after ~2 silent days;
# the weekly academia-digest after ~8 (an 8-day window always spans a Monday, so
# one healthy weekly run keeps it green).
locals {
  cron_alarms = var.enable_cron_alarms ? {
    "reap-afk-presence"      = 2
    "reap-stale-competitive" = 2
    "reap-pending-deletions" = 2
    "expire-grants"          = 2
    "academia-digest"        = 8
  } : {}
}

resource "aws_cloudwatch_metric_alarm" "cron_heartbeat" {
  for_each = local.cron_alarms

  alarm_name          = "lionade-cron-missing-${each.key}"
  namespace           = "Lionade/Crons"
  metric_name         = "Heartbeat"
  dimensions          = { Job = each.key }
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = each.value
  datapoints_to_alarm = each.value
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_description   = "No heartbeat from the ${each.key} cron; it may be failing silently."
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]
  ok_actions          = [aws_sns_topic.ops_alerts.arn]
  tags                = { Project = "Lionade", ManagedBy = "Terraform" }
}

# ═══════════════════════════════════════════════════════════════════════════
# Cost-allocation tags + a Cost Category + a staging budget. Makes spend
# SLICEABLE (by service area + by environment) BEFORE Bedrock lands, so "what is
# AI costing me" and "staging vs prod" become answerable instead of one lump.
#
# 🔴 MANUAL STEP (Terraform genuinely cannot do this on a standalone account):
# Billing console > Cost allocation tags > activate Project, Environment,
# ManagedBy as user-defined cost-allocation tags. ~24-48h backfill. Do this
# FIRST; the Environment tag filter below stays empty until activation
# propagates. The tags are already stamped on every resource in this file.
# ═══════════════════════════════════════════════════════════════════════════

# Group spend by service area so the bill reads in Lionade terms — Bedrock (AI)
# is isolated from day one, the rest split Storage / CDN / State / Monitoring.
resource "aws_ce_cost_category" "area" {
  name         = "LionadeArea"
  rule_version = "CostCategoryExpression.v1"

  rule {
    value = "Storage"
    type  = "REGULAR"
    rule {
      dimension {
        key           = "SERVICE"
        values        = ["Amazon Simple Storage Service"]
        match_options = ["EQUALS"]
      }
    }
  }

  rule {
    value = "CDN"
    type  = "REGULAR"
    rule {
      dimension {
        key           = "SERVICE"
        values        = ["Amazon CloudFront"]
        match_options = ["EQUALS"]
      }
    }
  }

  rule {
    value = "AI"
    type  = "REGULAR"
    rule {
      dimension {
        key           = "SERVICE"
        values        = ["Amazon Bedrock"]
        match_options = ["EQUALS"]
      }
    }
  }

  rule {
    value = "State + Locks"
    type  = "REGULAR"
    rule {
      dimension {
        key           = "SERVICE"
        values        = ["Amazon DynamoDB"]
        match_options = ["EQUALS"]
      }
    }
  }

  rule {
    value = "Monitoring"
    type  = "REGULAR"
    rule {
      dimension {
        key           = "SERVICE"
        values        = ["AmazonCloudWatch", "Amazon Simple Notification Service"]
        match_options = ["EQUALS"]
      }
    }
  }

  default_value = "Other"
}

# Staging gets its own trip-wire so a runaway staging experiment is visible
# apart from prod. Empty until the Environment tag is activated (manual step).
resource "aws_budgets_budget" "staging" {
  name         = "lionade-staging"
  budget_type  = "COST"
  limit_amount = "10"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Environment$staging"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# ─── Outputs — set the role ARNs as Vercel env to activate each feature ────
output "user_uploads_bucket" {
  value       = aws_s3_bucket.user_uploads.id
  description = "USER_UPLOADS_BUCKET"
}

output "uploads_web_role_arn" {
  value       = local.oidc_enabled ? aws_iam_role.uploads_web[0].arn : "(set vercel_team_slug to create)"
  description = "UPLOADS_WEB_ROLE_ARN (presign + sign-read)"
}

output "uploads_reaper_role_arn" {
  value       = local.oidc_enabled ? aws_iam_role.uploads_reaper[0].arn : "(set vercel_team_slug to create)"
  description = "UPLOADS_REAPER_ROLE_ARN (cron purge)"
}

output "cloudwatch_role_arn" {
  value       = local.oidc_enabled ? aws_iam_role.cron_heartbeat[0].arn : "(set vercel_team_slug to create)"
  description = "CLOUDWATCH_ROLE_ARN (cron heartbeat)"
}

output "ops_alerts_topic_arn" {
  value       = aws_sns_topic.ops_alerts.arn
  description = "SNS topic ARN for cron/ops alerts"
}

# ═══════════════════════════════════════════════════════════════════════════
# AWS roadmap STEP 1 — cost guardrails (Budgets + Cost Anomaly Detection).
# Free (first 2 budgets + anomaly detection cost nothing). Do this BEFORE
# turning on anything billable. NOTE: the account must have Cost Explorer
# enabled once in the Billing console for budgets/anomaly data to populate,
# and Free Tier usage alerts are a separate one-time Billing-console toggle
# (Billing > Billing preferences > "Receive Free Tier Usage Alerts").
# ═══════════════════════════════════════════════════════════════════════════

variable "alert_email" {
  type        = string
  default     = "samuelcasasramirez@gmail.com"
  description = "Where cost + anomaly alerts are sent"
}

# Monthly trip-wire: forecast >80% and actual >100% both email Sam.
resource "aws_budgets_budget" "monthly" {
  name         = "lionade-monthly"
  budget_type  = "COST"
  limit_amount = "25"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# ML anomaly detection across the whole account — catches the unknowns a fixed
# budget can't (a Bedrock token loop, an idle endpoint, a CloudFront egress
# spike). Alerts on >= $10 of anomalous spend.
resource "aws_ce_anomaly_monitor" "account" {
  name              = "lionade-account-monitor"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "account" {
  name             = "lionade-anomaly-alerts"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.account.arn]

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = ["10"]
    }
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# AWS roadmap STEP 2 — remote Terraform state (S3 + DynamoDB lock). Closes the
# ops-terraform TODO: state moves off the local laptop disk into a versioned,
# encrypted S3 bucket with a DynamoDB lock table, so a lost machine or a
# concurrent apply can't corrupt the source of truth. Effectively free.
#
# BOOTSTRAP ORDER (one-time): these resources are created FIRST with local
# state, THEN the backend block (backend.tf) is enabled and state migrated.
# See backend.tf for the exact runbook — do NOT enable the backend before the
# first apply creates this bucket + table.
# ═══════════════════════════════════════════════════════════════════════════

resource "aws_s3_bucket" "tf_state" {
  bucket = "lionade-tf-state"
  tags   = { Project = "Lionade", ManagedBy = "Terraform" }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Keep a recovery window of old state versions, then expire so they don't
# accumulate forever (90d is generous for state; pennies either way).
resource "aws_s3_bucket_lifecycle_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  rule {
    id     = "expire-noncurrent-state"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_dynamodb_table" "tf_locks" {
  name         = "lionade-tf-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = { Project = "Lionade", ManagedBy = "Terraform" }
}
