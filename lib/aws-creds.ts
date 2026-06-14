/**
 * AWS credentials via Vercel OIDC (server-only) — replaces long-lived keys.
 *
 * On Vercel, the runtime injects a short-lived OIDC token that is exchanged for
 * temporary STS credentials by assuming a scoped IAM role (auto-refreshed by
 * @vercel/functions/oidc). No static AWS access key ever lives in env.
 *
 * `roleCredentials(roleArn)` returns a credential provider for that role, or
 * `undefined` when the role ARN is not configured — so every AWS-touching
 * feature stays DORMANT until its role ARN env var is set on Vercel (and OIDC
 * is enabled for the project). Off-Vercel (local/CI) there is no OIDC token, so
 * these clients only function in the Vercel runtime; that is intentional for
 * the dormant-until-activated pilots.
 */

import { awsCredentialsProvider } from "@vercel/functions/oidc";

export function roleCredentials(
  roleArn: string | undefined,
): ReturnType<typeof awsCredentialsProvider> | undefined {
  if (!roleArn) return undefined;
  return awsCredentialsProvider({ roleArn });
}
