# ─────────────────────────────────────────────────────────────────────────
# backend.tf — Terraform remote state (S3 + DynamoDB lock).
#
# AWS roadmap step 2. The state bucket (aws_s3_bucket.tf_state) and lock table
# (aws_dynamodb_table.tf_locks) are defined in main.tf. Because a backend
# cannot reference resources in the state it backs, this is a two-step
# bootstrap — keep the block below COMMENTED until the resources exist.
#
# ── BOOTSTRAP RUNBOOK (one-time, in order) ──────────────────────────────────
#   1. Leave the `terraform { backend "s3" {...} }` block below COMMENTED.
#      Run `terraform apply` so main.tf creates lionade-tf-state +
#      lionade-tf-locks (using the current local state).
#   2. UNCOMMENT the block below.
#   3. Run `terraform init -migrate-state` and answer "yes" to copy the local
#      terraform.tfstate up to S3.
#   4. Confirm `terraform plan` shows no changes. The local terraform.tfstate
#      is now obsolete (still gitignored); state lives in S3, locked by DynamoDB.
#
# After this, a lost laptop or a concurrent apply can no longer corrupt state.
# ─────────────────────────────────────────────────────────────────────────

# terraform {
#   backend "s3" {
#     bucket         = "lionade-tf-state"
#     key            = "lionade/terraform.tfstate"
#     region         = "us-east-1"
#     dynamodb_table = "lionade-tf-locks"
#     encrypt        = true
#   }
# }
