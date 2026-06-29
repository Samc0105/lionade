import type { Shift } from "./types";

// NetOps Shift 1: the same desk, the wiring closet and the cloud console behind
// it. This is the Network / Cloud Ops track: subnets and CIDR math, DNS that
// stops resolving, a load balancer that keeps feeding a dead backend, an IAM
// role with far too much power, and a 2am page that is a warning, not an outage.
// Surfaces are the case queue, the terminal (network and cloud tooling), the
// knowledge base, and the phone for the on-call page. The lessons are the ops
// instincts: size for the real need, fix at the source of truth, let failover do
// its job, grant least privilege, and triage severity before you pull a big
// lever.
//
// Economy note (HELD): every reward and xp field below is a DISPLAY PREVIEW only,
// exactly like the rest of the campaign. The real grant is server authoritative
// and clamped in app/api/techhub/shifts/complete, gated by the held migration
// 20260626120000. The matching ceiling lives there as
// "netops-shift-1": { maxFangs: 240 }. Until the migration is applied this shift
// banks nothing, the same held state as every other shift. Never grant from the
// client.

export const NETOPS_SHIFT_1: Shift = {
  id: "netops-shift-1",
  track: "netops",
  order: 0,
  name: "On Call: The Network Holds Tonight",
  rank: "Junior Network Engineer",
  accent: "#22D3EE",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-subnet-sizing",
      title: "Size a subnet with CIDR",
      tags: ["subnet", "cidr", "network", "ip"],
      body: [
        "A subnet's CIDR suffix sets how many addresses it holds. In the cloud, five addresses are reserved per subnet, so a /24 gives about 251 usable, a /23 about 507, and a /22 over a thousand. Each step down doubles the size.",
        "Pick the smallest block that fits your host count with a little headroom. Oversizing wastes the address range and crowds out other subnets in the VPC; undersizing forces a painful renumber the day you run out. Plan for growth, not for the whole datacenter.",
      ],
    },
    {
      id: "kb-dns-resolution",
      title: "When a name will not resolve",
      tags: ["dns", "resolution", "nxdomain", "network"],
      body: [
        "If a host answers by IP but fails by name, the network is fine and the problem is name resolution. NXDOMAIN means the resolver asked the authoritative zone and the record genuinely is not there.",
        "Fix it at the source: restore or correct the record in the authoritative zone so every caller recovers at once. Editing one server's hosts file or flushing a cache only hides a zone problem, and it rots the moment an address changes.",
      ],
    },
    {
      id: "kb-lb-failover",
      title: "Load balancer health checks and failover",
      tags: ["load balancer", "failover", "health check", "incident"],
      body: [
        "A load balancer routes around a failed backend only if its health check tells the truth. A probe rigged to always pass means the balancer keeps sending traffic to a dead node, so a share of requests fail while the rest succeed.",
        "Fix the health check (a real probe, such as an HTTP 200 on a health path) and the balancer drains the failing backend and fails over to the healthy ones on its own. Restarting the balancer or adding capacity does nothing while the probe still lies.",
      ],
    },
    {
      id: "kb-least-privilege",
      title: "Least privilege for cloud IAM",
      tags: ["iam", "least privilege", "cloud", "security"],
      body: [
        "A role should be allowed to do only what it actually does, and nothing more. A deploy role that only ships one service and reads one bucket has no business holding administrator over the whole account.",
        "Scope the policy to the real, observed usage. Then a leaked credential can do almost nothing instead of owning everything. Grant the next permission when a task genuinely needs it, rather than handing out admin for convenience.",
      ],
    },
    {
      id: "kb-oncall-triage",
      title: "Triage the pager: severity first",
      tags: ["on call", "paging", "triage", "incident"],
      body: [
        "Not every page is an outage. Before you pull a big lever like a failover, ask two things: what is the thing (a primary or a replica), and is anything actually broken right now, or is it only a warning.",
        "A warning threshold buys you time. Acknowledge the page, make a little headroom so it does not get worse, and schedule the real fix for business hours. Waking the whole rotation for a non-outage burns the people you will need for a real one.",
      ],
    },
  ],

  items: [
    {
      id: "net-subnet-sizing",
      channel: "ticket",
      priority: "P3",
      from: { name: "Platform request", role: "Platform team" },
      subject: "New VPC subnet for up to 500 hosts: what size?",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 38,
      xp: 30,
      ticketBody:
        "A new service needs its own subnet in the VPC, sized for up to 500 hosts with a little room to grow. Pick the CIDR block that fits without wasting the range.",
      evidence: [
        {
          label: "Sizing notes",
          lines: [
            "Need room for up to 500 hosts, plus a little headroom",
            "/24 = 256 addresses, about 251 usable in cloud: too small",
            "/23 = 512 addresses, about 507 usable: fits 500 with headroom",
            "/22 = 1024 addresses: works but wastes about half the block",
          ],
        },
      ],
      commands: [
        {
          aliases: ["calc", "ipcalc", "subnet"],
          output:
            "Up to 500 hosts. A /24 is about 251 usable (too small). A /23 is about 507 usable and fits 500 with headroom. A /22 is over a thousand usable, far more than needed.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-subnet-sizing",
      goal: "Pick the CIDR block that fits 500 hosts without wasting the range.",
      hint: "A /24 holds about 251, a /23 about 507, a /22 over a thousand. Which is the smallest that still fits 500 with a little room?",
      actions: [
        {
          id: "pick-23",
          label: "Allocate a /23 (about 507 usable, fits 500 with a little headroom)",
          correct: true,
          requires: ["diag"],
          csat: 14,
          teach:
            "Right size. A /23 gives about 507 usable addresses, enough for 500 with a little room to grow and no big block sitting idle. A /24 would have run out, and a /22 would have wasted half the range.",
        },
        {
          id: "pick-24",
          label: "Allocate a /24 (it is the usual default)",
          correct: false,
          csat: -6,
          teach:
            "A /24 is only about 251 usable addresses and you need 500. It would run out fast and force a painful renumber later. Size for the real host count, not the default.",
        },
        {
          id: "pick-22",
          label: "Allocate a /22 to be safe",
          correct: false,
          csat: -5,
          teach:
            "A /22 is over a thousand usable addresses for 500 hosts, so half the block sits idle and crowds out other subnets in the VPC. Leave headroom, do not waste the whole range.",
        },
      ],
    },
    {
      id: "net-dns-failure",
      channel: "ticket",
      priority: "P2",
      from: { name: "App team", role: "Backend" },
      subject: "api.internal stopped resolving about an hour ago",
      slaMinutes: 25,
      arriveAfter: 25,
      reward: 44,
      xp: 36,
      ticketBody:
        "Our service can reach hosts fine by IP, but every lookup of api.internal fails with NXDOMAIN. It worked this morning. The app keeps timing out.",
      evidence: [
        {
          label: "What we see",
          lines: [
            "ping 10.20.0.15 (the api host) succeeds: the host is up",
            "nslookup api.internal returns NXDOMAIN",
            "Other names in the same zone also fail to resolve",
            "Change log: the internal DNS zone was edited at 09:40",
          ],
        },
      ],
      commands: [
        {
          aliases: ["dig", "nslookup", "resolve"],
          output:
            "dig api.internal returns NXDOMAIN. The authoritative internal zone answers, but the A record for api.internal is gone. A bulk zone edit at 09:40 dropped several records.",
          step: "diag",
        },
        {
          aliases: ["ping", "reach", "ip"],
          output:
            "Pinging the known IP 10.20.0.15 works. The host and network are healthy. The failure is name resolution, not connectivity.",
        },
      ],
      kbArticleId: "kb-dns-resolution",
      goal: "Find why the name will not resolve and fix it at the right layer.",
      hint: "The host pings fine by IP, so it is up. Only the name fails, and a zone edit landed at 09:40. Where is the real fix?",
      actions: [
        {
          id: "restore-record",
          label: "Restore the missing A record in the internal DNS zone (and tighten review on bulk zone edits)",
          correct: true,
          requires: ["diag"],
          csat: 14,
          teach:
            "That is the fix. The host was always up; the 09:40 zone edit dropped the api.internal A record, so the name stopped resolving. Restoring the record in the zone fixes every caller at once. Connectivity was never the problem.",
        },
        {
          id: "edit-hosts",
          label: "Hard code the IP in each app server's hosts file",
          correct: false,
          csat: -7,
          teach:
            "A hosts file entry papers over one box and rots the moment the IP changes. The zone is the source of truth for the whole org. Fix the record there, not on each server.",
        },
        {
          id: "flush-dns",
          label: "Just flush the DNS cache and move on",
          correct: false,
          csat: -6,
          teach:
            "A flush would help if a stale cache were the issue, but the authoritative zone is missing the record, so a flush only re-fetches the same NXDOMAIN. Restore the record at the source.",
        },
      ],
    },
    {
      id: "net-lb-root",
      channel: "ticket",
      priority: "P1",
      from: { name: "Multiple services", role: "Production" },
      subject: "About half of all requests are returning 502",
      slaMinutes: 15,
      arriveAfter: 45,
      reward: 55,
      xp: 44,
      incident: { group: "lb-failover", root: true },
      ticketBody:
        "A flood of alerts: roughly half of incoming requests have returned 502 since 14:10. The other half are fine. Customers are reporting the site is flaky.",
      evidence: [
        {
          label: "Load balancer pool",
          lines: [
            "Two backends: web-a (healthy) and web-b (failing since 14:08)",
            "The balancer still sends traffic to web-b: its health check is set to always pass",
            "Requests routed to web-a succeed, requests to web-b return 502",
            "web-a alone can carry the current traffic",
          ],
        },
      ],
      commands: [
        {
          aliases: ["status", "pool", "backends", "lb"],
          output:
            "Two backends. web-a healthy, web-b down since 14:08. The health check on web-b is rigged to always pass, so the balancer never drains it. Half the round-robin traffic hits the dead node.",
          step: "diag",
        },
        {
          aliases: ["healthcheck", "probe", "check"],
          output:
            "web-b health probe is hardcoded to report healthy. A real probe (an HTTP 200 on /healthz) would mark it down and the balancer would route around it on its own.",
        },
      ],
      kbArticleId: "kb-lb-failover",
      goal: "Stop the 502s for everyone. Find the single cause.",
      hint: "Half the traffic fails because the balancer still trusts a dead backend. What makes a load balancer route around a failure by itself?",
      actions: [
        {
          id: "fix-healthcheck",
          label: "Fix web-b's health check so the balancer drains it and traffic fails over to web-a",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the incident. The health check was rigged to always pass, so the balancer kept feeding the dead backend and half of all requests 502ed. A real health check marks web-b down, the balancer fails over to web-a, and every duplicate report clears at once.",
        },
        {
          id: "restart-lb",
          label: "Restart the load balancer",
          correct: false,
          csat: -6,
          teach:
            "A restart drops every live connection and the balancer comes back with the same broken health check, so half the traffic 502s again. Fix the health check, do not bounce the balancer.",
        },
        {
          id: "scale-up",
          label: "Add more backends behind the balancer",
          correct: false,
          csat: -7,
          teach:
            "More backends do not help while the balancer still routes to a dead one. You would just add capacity around the real bug. Fix the health check so the balancer drains the failing node.",
        },
      ],
    },
    {
      id: "net-lb-dup-1",
      channel: "ticket",
      priority: "P2",
      from: { name: "Priya", role: "Checkout team" },
      subject: "Checkout fails about half the time",
      slaMinutes: 20,
      arriveAfter: 52,
      reward: 8,
      xp: 6,
      incident: { group: "lb-failover" },
      ticketBody: "Some checkout requests go through, others return 502. It is intermittent. Is it just us?",
      goal: "Handle it. Sound familiar?",
      hint: "Other teams are reporting the same intermittent 502 right now.",
      actions: [
        {
          id: "ack-lb-1",
          label: "Link it to the load balancer incident",
          correct: true,
          csat: 2,
          outcome: "resolved",
          teach: "Right, it is the failover incident. The root fix on the health check closes this one too.",
        },
        {
          id: "blame-checkout",
          label: "Tell them to debug their checkout code",
          correct: false,
          csat: -3,
          teach: "Their code is fine; the requests that reach the healthy backend succeed. It is the balancer sending half the traffic to a dead node, not their service.",
        },
      ],
    },
    {
      id: "net-lb-dup-2",
      channel: "ticket",
      priority: "P3",
      from: { name: "Status page bot", role: "Monitoring" },
      subject: "Elevated 502 rate, public status degraded",
      slaMinutes: 25,
      arriveAfter: 60,
      reward: 8,
      xp: 6,
      incident: { group: "lb-failover" },
      ticketBody: "Automated alert: the public 502 rate is elevated and the status page flipped to degraded.",
      goal: "Same incident.",
      hint: "Fix the root and the error rate falls on its own.",
      actions: [
        {
          id: "ack-lb-2",
          label: "Link it to the load balancer incident",
          correct: true,
          csat: 2,
          outcome: "resolved",
          teach: "Yes, the root health check fix brings the 502 rate back down and the status page recovers.",
        },
        {
          id: "edit-statuspage",
          label: "Just flip the status page back to green",
          correct: false,
          csat: -5,
          teach: "Hiding the alert does not fix the 502s. The status page is telling the truth. Fix the root cause and it clears itself.",
        },
      ],
    },
    {
      id: "net-iam-overperm",
      channel: "ticket",
      priority: "P2",
      from: { name: "Security review", role: "Cloud governance" },
      subject: "A deploy role has full admin on the whole account",
      slaMinutes: 30,
      arriveAfter: 80,
      reward: 46,
      xp: 38,
      ticketBody:
        "An access review flagged the CI deploy role. It holds full administrator on the entire cloud account, but it only ever deploys one app and reads one bucket. Fix the over-permission.",
      evidence: [
        {
          label: "IAM finding",
          lines: [
            "Role: ci-deploy-role",
            "Granted: AdministratorAccess (every action on every resource)",
            "Used in the last 90 days: deploy to one app service and read one bucket",
            "A leaked credential on this role would own the whole account",
          ],
        },
      ],
      commands: [
        {
          aliases: ["policy", "iam", "review", "access"],
          output:
            "ci-deploy-role holds AdministratorAccess, but its 90 day usage is only: deploy to the one app service and read one bucket. Everything else is unused standing risk.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-least-privilege",
      goal: "Right-size the role's permissions to what it actually needs.",
      hint: "The role can do everything but only ever does two things. What is the principle that closes that gap?",
      actions: [
        {
          id: "scope-least-priv",
          label: "Replace admin with a scoped policy allowing only the deploy and the one bucket read (least privilege)",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is least privilege. Grant only the actions the role actually uses (deploy the one service, read the one bucket) and nothing else. Now a leaked credential can do almost nothing instead of owning the whole account.",
        },
        {
          id: "leave-admin",
          label: "Leave admin in place so deploys never break on a missing permission",
          correct: false,
          csat: -9,
          teach:
            "Convenience is not a reason to hand a CI role the keys to the kingdom. One leaked credential would compromise everything. Scope it to what it uses, and add a permission later if a deploy genuinely needs one.",
        },
        {
          id: "delete-role",
          label: "Delete the role entirely",
          correct: false,
          csat: -6,
          teach:
            "Deleting it breaks every deploy that depends on it. The role is needed, it is just over-permissioned. Right-size it to least privilege, do not remove it.",
        },
      ],
    },
    {
      id: "net-oncall-paging",
      channel: "phone",
      priority: "P2",
      from: { name: "On-call page", role: "Pager" },
      subject: "Paged: disk usage warning on a database node",
      slaMinutes: 20,
      arriveAfter: 110,
      reward: 42,
      xp: 34,
      phone: {
        opener:
          "hey it is the pager, i got woken up by a disk warning on db-3, it says 82 percent full, do i fail the database over right now or what",
        followups: [
          {
            label: "Is db-3 a primary or a replica, and is anything actually failing right now?",
            reply:
              "let me look... it is a read replica, and nothing is down, queries are still serving fine. it is just the warning at 82 percent.",
            correct: true,
          },
          {
            label: "Just fail it over to be safe, we can look in the morning",
            reply: "ok hang on, failing over a healthy replica at 2am seems like a lot for a warning, are you sure?",
          },
          {
            label: "Ignore it, disk warnings are always noise",
            reply: "i mean... it is climbing though, 82 percent. if it fills up the replica falls over. you sure we just ignore it?",
          },
        ],
      },
      kbArticleId: "kb-oncall-triage",
      goal: "Triage the page and decide if it is urgent enough to wake the team or a task for the morning.",
      hint: "Before you fail anything over, ask what db-3 is and whether anything is actually broken. A warning is not an outage.",
      actions: [
        {
          id: "ack-and-schedule",
          label: "Acknowledge the page, make headroom (clear old logs or grow the volume), and hand the root cause to the morning",
          correct: true,
          requires: ["phone"],
          csat: 14,
          teach:
            "Correct triage. You asked first and learned db-3 is a healthy read replica at a warning threshold, not an outage. Acknowledge the page, buy headroom by clearing old logs or growing the volume, and schedule the real cleanup for business hours. Waking the whole team for a warning burns people you will need for a real incident.",
        },
        {
          id: "failover-now",
          label: "Page the whole team and fail the database over immediately",
          correct: false,
          csat: -8,
          teach:
            "You turned a warning into an outage. Failing over a healthy replica at 2am drops connections and wakes the whole on-call rotation for something that was never down. Triage the severity before you pull the big lever.",
        },
        {
          id: "ignore-page",
          label: "Silence the page and go back to sleep",
          correct: false,
          csat: -9,
          teach:
            "The disk is at 82 percent and climbing. Ignore it and the replica fills up and actually falls over later. A warning is not nothing. Acknowledge it, make headroom, and schedule the fix.",
        },
      ],
    },
  ],
};
