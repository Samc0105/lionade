/**
 * One-shot Stripe product + price creation for Lionade.
 * Run: node scripts/stripe-setup.mjs
 * Outputs the full Vercel env block at the end.
 */

const API_KEY = process.env.STRIPE_RESTRICTED_KEY || process.env.STRIPE_SECRET_KEY;
if (!API_KEY) {
  console.error("Set STRIPE_RESTRICTED_KEY or STRIPE_SECRET_KEY in your env");
  process.exit(1);
}

async function stripe(method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${json.error?.message}`);
  return json;
}

async function createProduct(name) {
  const p = await stripe("POST", "products", { name });
  console.log(`  ✓ Product: ${name} (${p.id})`);
  return p.id;
}

async function createPrice(productId, amount, currency, opts = {}) {
  const body = {
    product: productId,
    unit_amount: String(Math.round(amount * 100)),
    currency,
  };
  if (opts.interval) {
    body["recurring[interval]"] = opts.interval;
  }
  const p = await stripe("POST", "prices", body);
  return p.id;
}

const results = {};

async function run() {
  console.log("\n── Subscriptions ──────────────────────────");

  const proId = await createProduct("Lionade Pro");
  results.STRIPE_PRICE_ID_PRO_MONTHLY = await createPrice(proId, 6.99, "usd", { interval: "month" });
  console.log(`    Monthly  → ${results.STRIPE_PRICE_ID_PRO_MONTHLY}`);
  results.STRIPE_PRICE_ID_PRO_ANNUAL = await createPrice(proId, 49.99, "usd", { interval: "year" });
  console.log(`    Annual   → ${results.STRIPE_PRICE_ID_PRO_ANNUAL}`);

  const platId = await createProduct("Lionade Platinum");
  results.STRIPE_PRICE_ID_PLATINUM_MONTHLY = await createPrice(platId, 12.99, "usd", { interval: "month" });
  console.log(`    Monthly  → ${results.STRIPE_PRICE_ID_PLATINUM_MONTHLY}`);
  results.STRIPE_PRICE_ID_PLATINUM_ANNUAL = await createPrice(platId, 89.99, "usd", { interval: "year" });
  console.log(`    Annual   → ${results.STRIPE_PRICE_ID_PLATINUM_ANNUAL}`);

  console.log("\n── Fang Packs ─────────────────────────────");

  const fangPacks = [
    { name: "5,000 Fangs",   price: 0.99,  key: "STRIPE_PRICE_ID_FANGS_S"  },
    { name: "30,000 Fangs",  price: 4.99,  key: "STRIPE_PRICE_ID_FANGS_M"  },
    { name: "140,000 Fangs", price: 19.99, key: "STRIPE_PRICE_ID_FANGS_L"  },
    { name: "400,000 Fangs", price: 49.99, key: "STRIPE_PRICE_ID_FANGS_XL" },
  ];
  for (const { name, price, key } of fangPacks) {
    const pid = await createProduct(name);
    results[key] = await createPrice(pid, price, "usd");
    console.log(`    ${name.padEnd(16)} → ${results[key]}`);
  }

  console.log("\n── Cosmetics ──────────────────────────────");

  const cosmetics = [
    { name: "Diamond Frame",    price: 4.99, key: "STRIPE_PRICE_ID_PREM_FRAME_DIAMOND"    },
    { name: "Neon Frame",       price: 2.99, key: "STRIPE_PRICE_ID_PREM_FRAME_NEON"       },
    { name: "Starfield Frame",  price: 1.99, key: "STRIPE_PRICE_ID_PREM_FRAME_STARFIELD"  },
    { name: "Holo Name Color",  price: 1.99, key: "STRIPE_PRICE_ID_PREM_NAME_HOLO"        },
    { name: "Gold Name Color",  price: 1.49, key: "STRIPE_PRICE_ID_PREM_NAME_GOLD"        },
    { name: "Fire Name Color",  price: 0.99, key: "STRIPE_PRICE_ID_PREM_NAME_FIRE"        },
    { name: "Eclipse Banner",   price: 5.99, key: "STRIPE_PRICE_ID_PREM_BANNER_ECLIPSE"   },
    { name: "Aurora X Banner",  price: 4.99, key: "STRIPE_PRICE_ID_PREM_BANNER_AURORA_X"  },
    { name: "Phoenix Banner",   price: 4.99, key: "STRIPE_PRICE_ID_PREM_BANNER_PHOENIX"   },
    { name: "Nebula Banner",    price: 3.99, key: "STRIPE_PRICE_ID_PREM_BANNER_NEBULA"    },
    { name: "Void Banner",      price: 3.49, key: "STRIPE_PRICE_ID_PREM_BANNER_VOID"      },
    { name: "Chromium Banner",  price: 3.49, key: "STRIPE_PRICE_ID_PREM_BANNER_CHROMIUM"  },
    { name: "Lightning Banner", price: 2.49, key: "STRIPE_PRICE_ID_PREM_BANNER_LIGHTNING" },
    { name: "Founding Scholar Badge", price: 14.99, key: "STRIPE_PRICE_ID_BADGE_FOUNDING_SCHOLAR" },
  ];
  for (const { name, price, key } of cosmetics) {
    const pid = await createProduct(name);
    results[key] = await createPrice(pid, price, "usd");
    console.log(`    ${name.padEnd(22)} → ${results[key]}`);
  }

  console.log("\n\n══════════════════════════════════════════════");
  console.log("  PASTE THIS INTO VERCEL ENVIRONMENT VARIABLES");
  console.log("══════════════════════════════════════════════\n");
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}=${v}`);
  }
  console.log("\n══════════════════════════════════════════════");
  console.log("  Done. Also add your live keys to Vercel:");
  console.log("  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...");
  console.log("  STRIPE_SECRET_KEY=sk_live_...");
  console.log("  STRIPE_WEBHOOK_SECRET=whsec_... (from dashboard → Webhooks)");
  console.log("══════════════════════════════════════════════\n");
}

run().catch((e) => { console.error(e.message); process.exit(1); });
