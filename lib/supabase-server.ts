// ⚠️  SERVER-ONLY — Never import this file in client components or pages.
// It uses the service role key which bypasses all Row Level Security.
// Only import in /app/api/* route handlers.

import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
