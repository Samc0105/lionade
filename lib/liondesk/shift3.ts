import type { Shift } from "./types";

// Shift 3: Sysadmin. You're past the front desk now and you own the servers.
// Higher stakes, tighter SLAs, and the calls a sysadmin actually sweats: a full
// disk taking prod down, a restore from backup, an expired certificate, a
// clean offboarding, and a runaway process. Terminal + knowledge base heavy.

export const SHIFT_3: Shift = {
  id: "helpdesk-shift-3",
  track: "helpdesk",
  order: 2,
  name: "Shift 3: The Server Room",
  rank: "Systems Administrator",
  accent: "#4A90D9",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-disk-full",
      title: "A server is down with a full disk",
      tags: ["disk", "full", "server", "500", "logs"],
      body: [
        "When an app throws errors and the root partition is at 100%, it can't write logs, temp files, or sessions. Free the space, then prevent it recurring.",
        "Use df to find the full partition and du to find what filled it. Truncating a runaway log frees the space immediately. Set up log rotation so it doesn't refill. Rebooting frees nothing.",
      ],
    },
    {
      id: "kb-restore",
      title: "Restore deleted files from backup",
      tags: ["backup", "restore", "deleted", "recovery"],
      body: [
        "Before you tell anyone data is gone, check the backups. Most shared folders are backed up nightly.",
        "Confirm a good backup exists and verify its timestamp, then restore the specific path. Never run unknown 'undelete' tools on a production server.",
      ],
    },
    {
      id: "kb-cert",
      title: "An expired TLS certificate",
      tags: ["ssl", "tls", "certificate", "expired", "https"],
      body: [
        "An expired certificate makes every browser warn users away. It is an availability and trust problem, not something to click through.",
        "Renew the certificate and deploy it, then confirm the chain and the new expiry. Telling users to bypass the warning trains them to ignore real security warnings.",
      ],
    },
    {
      id: "kb-offboarding",
      title: "Offboard a departed employee",
      tags: ["offboarding", "account", "retention", "security"],
      body: [
        "When someone leaves, disable their account and revoke access immediately so it cannot be used. Do not delete it outright.",
        "Their mailbox and files are often subject to retention or a manager handover. Disable and preserve per policy; deletion can destroy records you are required to keep.",
      ],
    },
  ],

  items: [
    {
      id: "sys-disk-full",
      channel: "ticket",
      priority: "P1",
      from: { name: "Monitoring", role: "alert" },
      subject: "app-prod-3 returning 500s, disk at 100%",
      asset: "app-prod-3",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 55,
      xp: 44,
      ticketBody: "The app server is throwing 500s for everyone. Disk alert is firing: root partition is full.",
      evidence: [
        { label: "Disk", lines: ["/dev/nvme0n1p1  50G  50G  0  100% /", "du: /var/log/app/debug.log = 48G", "Someone left LOG_LEVEL=DEBUG on since last week", "no logrotate config for that file"] },
      ],
      commands: [
        { aliases: ["df", "disk"], output: "Root partition / is 100% full (50G/50G). The app can't write anything, hence the 500s.", step: "diag" },
        { aliases: ["du", "find big"], output: "/var/log/app/debug.log is 48G. DEBUG logging was left on, no rotation. That's the whole disk.", step: "diag" },
      ],
      kbArticleId: "kb-disk-full",
      goal: "Get prod back up and keep it from happening again.",
      hint: "The disk is full, so the app can't write. Find what's eating it before you touch the server.",
      actions: [
        { id: "truncate-rotate", label: "Truncate the runaway log, turn DEBUG off, and add log rotation", correct: true, requires: ["diag"], csat: 16, teach: "Clean fix. Truncating the 48G debug log frees the disk instantly and the app recovers. Turning DEBUG off and adding rotation stops the repeat. df to find it, du to name it, then fix the cause." },
        { id: "reboot-server", label: "Reboot the server", correct: false, csat: -7, teach: "A reboot frees no disk space; the 48G log is still there and the disk fills again in minutes. You also took prod fully offline for nothing." },
        { id: "resize-disk", label: "Resize the disk to 100G", correct: false, csat: -5, teach: "That's throwing hardware at a logging bug. It buys a few days, then the unrotated DEBUG log fills the bigger disk too. Fix the log, not the symptom." },
      ],
    },
    {
      id: "sys-restore",
      channel: "ticket",
      priority: "P1",
      from: { name: "Dana Lopez", role: "Accounting", vip: true },
      subject: "I deleted the shared Close folder by accident",
      slaMinutes: 20,
      arriveAfter: 40,
      reward: 50,
      xp: 40,
      ticketBody: "I think I dragged the entire month-end Close folder to trash and emptied it. It's gone from the share. The whole team needs it. Please tell me it's recoverable.",
      evidence: [
        { label: "Backup status", lines: ["Nightly backup of //fileserver/Finance: SUCCESS at 02:00 today", "Close folder present in last night's snapshot", "Retention: 30 daily snapshots"] },
      ],
      kbArticleId: "kb-restore",
      goal: "Recover Dana's folder. Check before you panic.",
      hint: "Before you say it's gone, what runs every night on the file server?",
      actions: [
        { id: "restore-backup", label: "Verify last night's backup has it, then restore the Close folder", correct: true, requires: ["kb"], csat: 14, teach: "Right move. The nightly backup captured the folder at 02:00, so you restore that path and Dana's team is back in business. Always check backups before declaring data lost." },
        { id: "declare-gone", label: "Tell her it's permanently gone", correct: false, csat: -9, teach: "It wasn't gone. A nightly backup had it the whole time. Declaring data lost without checking the backups is the cardinal sysadmin sin." },
        { id: "sketchy-undelete", label: "Run a downloaded undelete tool on the file server", correct: false, csat: -7, teach: "Never run unknown recovery tools on a production server; you risk corrupting the volume. You have a clean, verified backup. Use it." },
      ],
    },
    {
      id: "sys-cert",
      channel: "ticket",
      priority: "P2",
      from: { name: "Marketing", role: "Web" },
      subject: "The website is showing a security warning",
      slaMinutes: 30,
      arriveAfter: 75,
      reward: 44,
      xp: 35,
      ticketBody: "Customers are saying our site shows 'Your connection is not private' and they're scared to continue. Started this morning.",
      evidence: [
        { label: "TLS check", lines: ["cert CN=getlionade.com  status: EXPIRED yesterday 23:59", "auto-renew job: failed silently 30 days ago", "every visitor sees the browser warning"] },
      ],
      commands: [
        { aliases: ["cert", "tls", "openssl"], output: "Certificate for getlionade.com EXPIRED yesterday. The auto-renew failed a month ago and nobody noticed. Every visitor is warned.", step: "diag" },
      ],
      kbArticleId: "kb-cert",
      goal: "Get the site trusted again.",
      hint: "The padlock broke for a reason a sysadmin checks first. What state is the certificate in?",
      actions: [
        { id: "renew-cert", label: "Renew the certificate and deploy it, then confirm the new expiry", correct: true, requires: ["diag"], csat: 14, teach: "That's it. The cert expired because auto-renew had been failing silently. Renewing and deploying clears the warning for everyone, and you'd add an alert on the renew job so it never lapses unseen again." },
        { id: "tell-clickthrough", label: "Tell customers to click through the warning", correct: false, csat: -10, teach: "Never train users to bypass security warnings; that's exactly how phishing wins. The fix is a valid certificate, not asking people to ignore the browser." },
        { id: "disable-https", label: "Disable HTTPS to stop the warning", correct: false, csat: -12, ends: true, outcome: "mishandled", teach: "Serving the site over plain HTTP exposes every customer's traffic. Removing encryption to silence an encryption warning is the wrong direction entirely. Renew the cert." },
      ],
    },
    {
      id: "sys-offboard",
      channel: "ticket",
      priority: "P2",
      from: { name: "HR", role: "People Ops" },
      subject: "Offboard departing employee (last day today)",
      slaMinutes: 25,
      arriveAfter: 110,
      reward: 40,
      xp: 32,
      ticketBody: "Please offboard an employee whose last day is today. Their manager needs access to their files for handover.",
      evidence: [
        { label: "Policy", lines: ["Standard offboarding: disable account + revoke SSO immediately", "Retain mailbox + files 90 days for handover and compliance", "Manager gets delegated access to the files"] },
      ],
      kbArticleId: "kb-offboarding",
      goal: "Offboard cleanly, the secure and compliant way.",
      hint: "You want their access gone now, but their data needs to survive for the handover. What does that rule out?",
      actions: [
        { id: "disable-preserve", label: "Disable the account and revoke access, preserve the mailbox and files per retention", correct: true, requires: ["kb"], csat: 13, teach: "Correct. Disabling kills access immediately while preserving the data the manager and compliance need. Clean, reversible, policy-compliant offboarding." },
        { id: "delete-now", label: "Delete the account and all their data right now", correct: false, csat: -9, teach: "You just destroyed files the manager needs for handover and records you're required to retain for 90 days. Disable, don't delete." },
        { id: "leave-active", label: "Leave the account active until the manager confirms handover", correct: false, csat: -8, teach: "A departed employee's live account and credentials are a standing security risk. Revoke access today; preserve the data separately." },
      ],
    },
    {
      id: "sys-runaway",
      channel: "ticket",
      priority: "P3",
      from: { name: "Monitoring", role: "alert" },
      subject: "build-server-1 pegged at 100% CPU",
      asset: "build-server-1",
      slaMinutes: 40,
      arriveAfter: 145,
      reward: 38,
      xp: 30,
      ticketBody: "The CI build server is at 100% CPU and builds are crawling. It's not the whole fleet, just this one box.",
      evidence: [
        { label: "top", lines: ["PID 8821  node  CPU 798%  a stuck build that never exited", "load average 24.0 on 8 cores", "other processes starved", "the build's parent job was cancelled hours ago"] },
      ],
      commands: [
        { aliases: ["top", "ps", "cpu"], output: "PID 8821 (node) is using ~800% CPU. It's an orphaned build process whose job was cancelled hours ago but the process never died.", step: "diag" },
      ],
      kbArticleId: "kb-disk-full",
      goal: "Get the build server breathing again with the least blast radius.",
      hint: "One process is eating the box, and its job was already cancelled. Do you need to nuke the whole server?",
      actions: [
        { id: "kill-process", label: "Kill the orphaned build process and clean it up", correct: true, requires: ["diag"], csat: 12, teach: "Right. A single orphaned process was pegging the CPU. Killing that one process frees the box without taking down the queued builds. Smallest blast radius that fixes it." },
        { id: "reboot-box", label: "Reboot the whole build server", correct: false, csat: -5, teach: "A reboot works but it kills every in-progress build and takes the box offline for minutes. When one process is the culprit, kill the process, not the server." },
        { id: "add-cpu", label: "Add more CPU cores to the box", correct: false, csat: -6, teach: "A runaway process will happily eat more cores too. The problem is a stuck process, not capacity. Kill it." },
      ],
    },
  ],
};
