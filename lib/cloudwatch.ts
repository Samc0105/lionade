/**
 * CloudWatch cron heartbeat (server-only) — the emit side of the dead-man's
 * switch. Each cron calls putCronHeartbeat(job) on a successful run, writing a
 * custom metric (Lionade/Crons -> Heartbeat, dimension Job). Terraform alarms
 * with treat_missing_data=breaching fire to SNS when a heartbeat goes missing,
 * so a silently-failing cron (e.g. the GDPR purge or the plan-grant expiry)
 * surfaces instead of being noticed only via a user complaint.
 *
 * DORMANT-SAFE: no-op until CLOUDWATCH_ROLE_ARN is set (Vercel OIDC role), so it
 * ships inert. NEVER throws — monitoring must never break the job it monitors.
 */

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { roleCredentials } from "@/lib/aws-creds";

// MUST equal the Terraform AWS provider region (terraform/main.tf, region =
// "us-east-1"). The alarms only watch that region; if heartbeats publish
// elsewhere, treat_missing_data=breaching fires every cron alarm. Pinned (NOT
// AWS_REGION-derived) so the heartbeat region can never drift from the alarm
// region via a mistyped Vercel env var.
const REGION = "us-east-1";
const ROLE_ARN = process.env.CLOUDWATCH_ROLE_ARN;
const NAMESPACE = "Lionade/Crons";

export function isCloudWatchConfigured(): boolean {
  return Boolean(ROLE_ARN);
}

let _client: CloudWatchClient | null = null;
function cw(): CloudWatchClient {
  if (!_client) {
    _client = new CloudWatchClient({ region: REGION, credentials: roleCredentials(ROLE_ARN) });
  }
  return _client;
}

/**
 * Emit a heartbeat for a cron job's successful run. No-op when unconfigured;
 * swallows + logs any error so a heartbeat failure can never fail the cron.
 */
export async function putCronHeartbeat(job: string): Promise<void> {
  if (!isCloudWatchConfigured()) return;
  try {
    await cw().send(
      new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [
          {
            MetricName: "Heartbeat",
            Dimensions: [{ Name: "Job", Value: job }],
            Value: 1,
            Unit: "Count",
          },
        ],
      }),
    );
  } catch (e) {
    console.error("[cloudwatch] heartbeat failed", job, e instanceof Error ? e.message : "unknown");
  }
}
