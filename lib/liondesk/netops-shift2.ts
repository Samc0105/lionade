import type { Shift } from "./types";

// NetOps Shift 2: The Backbone Bends. A harder on call rotation for a Network
// Engineer II. Shift 1 covered the fundamentals; this shift is the set of failures
// that look like one thing and are really another: large transfers that hang while
// small ones fly (an MTU problem), a sudden company wide certificate error, a whole
// region that drops off the map after a routing change, outbound calls that fail
// only at peak (source port exhaustion), and a second internet link that breaks
// traffic instead of adding capacity. The instincts: find the real layer, fix at
// the source of truth, and choose the smallest correct change.
//
// Economy note (HELD): every reward and xp value below is a DISPLAY PREVIEW only.
// The real grant is server authoritative and clamped in
// app/api/techhub/shifts/complete, where this shift's ceiling lives as
// "netops-shift-2": { maxFangs: 300 }. Until the held migration 20260626120000 is
// applied this shift banks nothing. Never grant Fangs from the client.

export const NETOPS_SHIFT_2: Shift = {
  id: "netops-shift-2",
  track: "netops",
  order: 1,
  name: "On Call 2: The Backbone Bends",
  rank: "Network Engineer II",
  accent: "#22D3EE",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-net2-mtu",
      title: "When small traffic works but large transfers hang (MTU)",
      tags: ["mtu", "mss", "tunnel", "fragmentation"],
      body: [
        "If small requests cross a link fine but large transfers stall, especially after a tunnel or VPN is added, suspect the maximum packet size. A tunnel adds overhead, so the usable size inside it is smaller than the standard link, and oversize packets with do not fragment set are dropped silently when the path cannot signal back (a path MTU black hole).",
        "Fix it at the packet layer: lower the tunnel interface MTU to fit the overhead and clamp the MSS so sessions negotiate a size that crosses, and allow the fragmentation notices the path needs so endpoints can learn the right size. It is never a bandwidth problem, and disabling the firewall does not size a packet.",
      ],
    },
    {
      id: "kb-net2-tls",
      title: "A company wide certificate error at one timestamp",
      tags: ["tls", "certificate", "expiry", "incident"],
      body: [
        "When every client fails a TLS handshake at the same instant while the host is up and the network is healthy, the cause is almost always an expired certificate. A single shared expiry locks everyone out at one timestamp; it is not the clients and not connectivity.",
        "Renew (rotate) the certificate, reload the service, and every client recovers at once. Then monitor the expiry date so the next renewal happens well in advance. Never tell clients to skip verification just to get connected: that accepts any certificate and invites interception, and it tends to stay off long after the incident.",
      ],
    },
    {
      id: "kb-net2-bgp",
      title: "A region black holed by a bad route",
      tags: ["routing", "bgp", "black hole", "incident"],
      body: [
        "When a whole region goes unreachable right after a routing change, look for a more specific route that beats the correct broader one and sends traffic to a dead next hop. The more specific route wins, so all that traffic is swallowed (black holed) even though everything else is fine.",
        "Fix it at the source: withdraw the bad advertisement at the router that originated it, and the correct route takes over for everyone at once. Rebooting the core router reloads the same bad route and widens the outage, and static routes on hosts do not scale and only mask a routing table that is still wrong.",
      ],
    },
    {
      id: "kb-net2-natexhaust",
      title: "Outbound failures only at peak (source port exhaustion)",
      tags: ["nat", "ports", "scaling", "cloud"],
      body: [
        "If outbound calls to an external service fail only at peak and recover off peak, and the NAT gateway logs source port allocation errors, you are exhausting source ports. Every concurrent connection behind one shared address needs its own port, and under heavy concurrency they run out.",
        "Relieve the real limit: add NAT capacity with more source addresses to multiply the available ports, and enable connection reuse (keep alive and pooling) so each call stops burning a fresh port. Raising file descriptor limits or retrying harder does not help, and aggressive retries open more connections and deepen the exhaustion.",
      ],
    },
    {
      id: "kb-net2-asym",
      title: "A second link breaks traffic (asymmetric routing)",
      tags: ["routing", "asymmetric", "firewall", "redundancy"],
      body: [
        "Adding a second link for redundancy can make traffic flaky if a flow's reply leaves by a different link than its request arrived on. A stateful firewall tracks each connection, so a reply with no matching state is dropped, which looks like random hangs and timeouts.",
        "The fix is symmetric routing: ensure each flow's request and reply travel the same link, using source based routing or matching policies. Keep both links and the firewall. Pulling the new link throws away the redundancy and only hides the problem, and disabling stateful inspection trades a routing bug for a serious security hole.",
      ],
    },
  ],

  items: [
    {
      id: "net2-mtu",
      channel: "ticket",
      priority: "P2",
      from: { name: "App team", role: "Backend" },
      subject: "Large transfers hang after the new site to site tunnel went up",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 44,
      xp: 36,
      ticketBody:
        "Since the new site to site VPN tunnel went live, small requests work fine but any large file transfer or big response stalls and eventually times out, but only across the tunnel. Direct traffic is unaffected.",
      evidence: [
        {
          label: "What we see",
          lines: [
            "Small packets cross the tunnel fine; large full size packets vanish",
            "A ping with a large size and do not fragment set fails across the tunnel, small pings succeed",
            "The tunnel adds overhead, so the usable packet size inside it is smaller than the standard link",
            "The path is silently dropping oversize packets (a path MTU black hole)",
          ],
        },
      ],
      commands: [
        {
          aliases: ["ping", "mtu", "diagnose"],
          output:
            "Large do not fragment pings fail across the tunnel while small ones succeed. The tunnel's overhead lowers the real usable packet size, and oversize packets are being dropped without a fragmentation notice. This is an MTU mismatch, not bandwidth.",
          step: "diag",
        },
        {
          aliases: ["throughput", "bandwidth"],
          output:
            "Link bandwidth is plentiful and small flows are fast. The stalls are tied to packet size on the tunnel, not to throughput.",
        },
      ],
      kbArticleId: "kb-net2-mtu",
      goal: "Make large transfers cross the tunnel reliably by fixing the real layer.",
      hint: "Small packets fly and large ones disappear, only on the tunnel that added overhead. This is about packet size, not speed. What do you adjust?",
      actions: [
        {
          id: "clamp-mss",
          label: "Lower the tunnel interface MTU to fit the overhead and clamp the MSS so large packets are sized to cross, and allow the fragmentation notices the path needs",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the fix at the right layer. The tunnel's overhead shrinks the usable packet size, and oversize packets were being dropped silently. Lowering the interface MTU and clamping the MSS sizes packets to fit the tunnel, so large transfers stop hanging. Allowing the fragmentation notices that signal path MTU is the other half of a durable fix.",
        },
        {
          id: "disable-firewall",
          label: "Disable the firewall on the tunnel to let everything through",
          correct: false,
          csat: -10,
          teach:
            "Turning off the firewall is both unsafe and beside the point: the packets are not blocked by policy, they are too large for the tunnel and dropped on the path. Size the packets to fit with an MTU and MSS change; do not strip your security to chase an MTU bug.",
        },
        {
          id: "more-bandwidth",
          label: "Order more bandwidth for the link",
          correct: false,
          csat: -7,
          teach:
            "Bandwidth is fine and small flows are fast, so more capacity changes nothing. The stalls are caused by oversize packets being dropped, a packet size problem. Fix the MTU and MSS, do not pay for throughput you are not short of.",
        },
      ],
    },
    {
      id: "net2-tls-expiry",
      channel: "ticket",
      priority: "P1",
      from: { name: "Many services", role: "Production" },
      subject: "Every client started failing the internal API with a certificate error at the same minute",
      slaMinutes: 15,
      arriveAfter: 30,
      reward: 52,
      xp: 44,
      ticketBody:
        "At 03:00 on the dot, every service that calls api.internal began failing the TLS handshake with a certificate error. Nothing was deployed. The host is up and answering on the network.",
      evidence: [
        {
          label: "What we see",
          lines: [
            "All clients fail the TLS handshake at the same instant, with a certificate error",
            "The certificate's notAfter date is now in the past: it expired at 03:00",
            "The host is reachable and the network is healthy; only the certificate is the problem",
            "A lockout that begins at one shared timestamp is a certificate expiry, not a client fault",
          ],
        },
      ],
      commands: [
        {
          aliases: ["openssl", "cert", "diagnose"],
          output:
            "The certificate served by api.internal has a notAfter in the past. It expired at 03:00, which is exactly when every client started failing the handshake. The network and host are fine; the certificate lapsed.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-net2-tls",
      goal: "Get every client connecting again by fixing the real cause, safely.",
      hint: "Everyone broke at the same instant and the host is up. The certificate's expiry time matches the outage. What recovers all clients at once without weakening security?",
      actions: [
        {
          id: "renew-cert",
          label: "Renew (rotate) the expired certificate, reload the service, and add expiry monitoring so this is caught well in advance next time",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Correct. A single timestamp lockout with a healthy host is the signature of an expired certificate. Renewing it and reloading the service recovers every client at once, and monitoring the expiry date means the next renewal happens long before the deadline instead of at 03:00 during an outage.",
        },
        {
          id: "disable-verify",
          label: "Tell every client to skip certificate verification so they connect again",
          correct: false,
          csat: -12,
          ends: true,
          outcome: "mishandled",
          teach:
            "Disabling verification makes every connection accept any certificate, which normalizes exactly the kind of interception attack the certificate exists to prevent, and it would quietly stay off long after this. Never trade away verification to dodge an expiry. Renew the certificate.",
        },
        {
          id: "restart-service",
          label: "Restart the API service and hope it clears",
          correct: false,
          csat: -7,
          teach:
            "A restart brings the same expired certificate back up, so every client fails the handshake again the moment it returns. The certificate is the problem, not the process. Renew it, then reload.",
        },
      ],
    },
    {
      id: "net2-bgp-blackhole",
      channel: "ticket",
      priority: "P1",
      from: { name: "Multiple regions", role: "Production" },
      incident: { group: "net2-bgp", root: true },
      subject: "A whole region fell off the map right after a routing change",
      slaMinutes: 15,
      arriveAfter: 60,
      reward: 55,
      xp: 46,
      ticketBody:
        "Minutes after a routine routing change, an entire region became unreachable. Traffic to its address range goes in and never comes back. Everything else is fine. The change window is still open.",
      evidence: [
        {
          label: "Routing state",
          lines: [
            "The outage began the instant a route map change was pushed to a core router",
            "A new, more specific route for the region's range sends traffic to a next hop that goes nowhere (a black hole)",
            "The more specific route wins over the correct broader route, so all the region's traffic is swallowed",
            "Rolling the change back restores the correct path for everyone at once",
          ],
        },
      ],
      commands: [
        {
          aliases: ["route", "bgp", "diagnose"],
          output:
            "A more specific route for the region's range was advertised by the change, and it beats the correct broader route, sending all that traffic to a dead next hop. The region is being black holed by the bad advertisement pushed in this window.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-net2-bgp",
      goal: "Bring the region back by fixing the cause at the source.",
      hint: "A routing change just advertised a more specific route that wins and dumps the region's traffic into a black hole. Where is the single correct fix?",
      actions: [
        {
          id: "withdraw-route",
          label: "Withdraw the bad route advertisement at the router that originated it, restoring the correct path",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the cause and the fix. The change advertised a more specific route that beat the correct one and black holed the region. Withdrawing that advertisement at its source lets the correct broader route take over again, and the whole region recovers at once. Fix it where it was introduced.",
        },
        {
          id: "reboot-core",
          label: "Reboot the core router to clear it",
          correct: false,
          csat: -9,
          teach:
            "A reboot drops every flow through that router and, when it comes back, it reloads the same bad route map and black holes the region again. You caused a wider outage and fixed nothing. Withdraw the bad advertisement at the source instead.",
        },
        {
          id: "static-route-hosts",
          label: "Add a static route on each affected host to force the path",
          correct: false,
          csat: -8,
          teach:
            "Static routes on individual hosts do not scale, drift out of date, and only paper over a routing table that is still wrong for everyone else. The real route was poisoned by the change. Remove the bad advertisement at the router that sent it.",
        },
      ],
    },
    {
      id: "net2-bgp-dup",
      channel: "ticket",
      priority: "P2",
      from: { name: "Regional support", role: "Customer Success" },
      incident: { group: "net2-bgp" },
      subject: "Customers in one region all report timeouts",
      slaMinutes: 25,
      arriveAfter: 66,
      reward: 8,
      xp: 6,
      ticketBody: "Every customer in one region says the service is unreachable, all starting a few minutes ago. Other regions are quiet.",
      goal: "Same event?",
      hint: "A whole region down at once, starting right after a change. Recognize it?",
      actions: [
        {
          id: "link-bgp",
          label: "Link it to the routing black hole incident",
          correct: true,
          csat: 2,
          outcome: "resolved",
          teach: "Yes. One region unreachable from one moment is the routing change, not many separate faults. Withdrawing the bad advertisement clears this report too.",
        },
        {
          id: "tell-customers-isp",
          label: "Tell the customers it is probably their own internet",
          correct: false,
          csat: -5,
          teach:
            "An entire region failing at the same instant is your routing change, not every customer's home internet at once. Link it to the incident and fix the route.",
        },
      ],
    },
    {
      id: "net2-snat-exhaustion",
      channel: "ticket",
      priority: "P2",
      from: { name: "App team", role: "Backend" },
      subject: "Outbound calls to a partner API fail only at peak",
      slaMinutes: 25,
      arriveAfter: 95,
      reward: 46,
      xp: 38,
      ticketBody:
        "The app tier's calls to an external partner API start failing during peak hours and clear up off peak. The partner says they are healthy and our errors are connection failures, not their rejections.",
      evidence: [
        {
          label: "What we see",
          lines: [
            "Failures appear only at peak and disappear off peak, scaling with concurrent outbound connections",
            "The NAT gateway logs show source port allocation errors during the peaks",
            "All outbound traffic shares one NAT address, and its source ports run out under heavy concurrency",
            "Connections are short lived and never reused, so each call burns a fresh source port",
          ],
        },
      ],
      commands: [
        {
          aliases: ["nat", "ports", "diagnose"],
          output:
            "The NAT gateway is exhausting source ports at peak: every concurrent outbound call needs its own port behind one shared address, and under load they run out. Off peak there is headroom, so it works. This is source port exhaustion, not the partner.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-net2-natexhaust",
      goal: "Stop the peak failures by relieving what is actually exhausted.",
      hint: "It only fails when many outbound connections overlap, and the NAT gateway is out of source ports. What gives you more ports and uses them more sparingly?",
      actions: [
        {
          id: "add-nat-reuse",
          label: "Add NAT capacity (more source addresses) and enable connection reuse (keep alive and pooling) so calls stop burning a fresh port each time",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Right on both counts. More source addresses multiply the available ports, and reusing connections through keep alive and pooling means far fewer ports are consumed in the first place. Together they remove the exhaustion at peak. You treated the real limit, the source ports, not a guess.",
        },
        {
          id: "raise-fd-limit",
          label: "Raise the operating system file descriptor limit on the app servers",
          correct: false,
          csat: -7,
          teach:
            "File descriptors are not what ran out; the NAT gateway's source ports are. More descriptors let a server open more sockets it still cannot place through an exhausted NAT. Add NAT capacity and reuse connections instead.",
        },
        {
          id: "retry-harder",
          label: "Make the app retry the failed calls more aggressively",
          correct: false,
          csat: -9,
          teach:
            "Aggressive retries open even more simultaneous connections at exactly the moment ports are scarce, so they deepen the exhaustion and make peak worse. Relieve the source ports with more NAT capacity and connection reuse, and retry gently if at all.",
        },
      ],
    },
    {
      id: "net2-link-phone",
      channel: "phone",
      priority: "P2",
      from: { name: "On call page", role: "Pager" },
      subject: "Paged: new second internet link, traffic now flaky",
      slaMinutes: 20,
      arriveAfter: 130,
      reward: 44,
      xp: 36,
      phone: {
        opener:
          "hey, the pager again. we brought up the second internet link tonight for redundancy, and now some connections work and some just hang and time out, kind of at random. should i just rip the new link back out?",
        followups: [
          {
            label: "Before we pull it, does the flakiness line up with the new link, and is the firewall in that path a stateful one?",
            reply:
              "yeah it started right when the second link came up. and yes, the firewall is stateful, it tracks each connection's state. why, does that matter here?",
            correct: true,
          },
          {
            label: "Just pull the second link back out and we will try again later",
            reply:
              "ok but then we lose the redundancy we just added, and if the real problem is how it is routed, it will break again next time. you sure pulling it is the fix?",
          },
          {
            label: "Ignore it, intermittent timeouts usually sort themselves out",
            reply: "they are not sorting out though, it is hanging on a real chunk of connections. i do not think this clears on its own.",
          },
        ],
      },
      kbArticleId: "kb-net2-asym",
      goal: "Find why a redundancy upgrade broke traffic, and fix routing instead of throwing away the new link.",
      hint: "Two links plus a stateful firewall. If a reply leaves by a different link than the request came in on, the firewall has no state for it and drops it. What needs to be true about each flow's path?",
      actions: [
        {
          id: "fix-symmetry",
          label: "Fix the routing so each flow's request and reply use the same link (symmetric routing), keeping both links and the stateful firewall",
          correct: true,
          requires: ["phone"],
          csat: 16,
          teach:
            "Exactly. With two links a reply was leaving by a different path than the request arrived on, and the stateful firewall, seeing a reply with no matching connection state, dropped it. Making each flow symmetric (request and reply on the same link) fixes the hangs while keeping the redundancy you just gained and your firewall intact.",
        },
        {
          id: "pull-link",
          label: "Rip the second link back out",
          correct: false,
          csat: -8,
          teach:
            "Pulling the link throws away the redundancy you added and only hides a routing problem that returns the next time anyone adds a path. The flakiness is asymmetric routing through a stateful firewall, which is fixable. Make the flows symmetric instead of retreating.",
        },
        {
          id: "disable-stateful",
          label: "Turn off the stateful firewall so it stops dropping the replies",
          correct: false,
          csat: -10,
          teach:
            "Disabling stateful inspection would stop the drops by removing a core security control, trading a routing bug for a much bigger exposure. Keep the firewall and fix the routing so requests and replies travel the same link.",
        },
      ],
    },
  ],
};
