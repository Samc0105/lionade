#!/usr/bin/env npx tsx
import fs from "fs";
import path from "path";

// ── Read .env.local ──────────────────────────────────────────
const envPath = path.join(__dirname, "..", ".env.local");
const env: Record<string, string> = {};
fs.readFileSync(envPath, "utf8")
  .split("\n")
  .forEach((line) => {
    const eq = line.indexOf("=");
    if (eq > 0)
      env[line.slice(0, eq).trim()] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  });

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SECRET_KEY;
const GEMINI_API_KEY = env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars in .env.local");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env.local — lesson text will be skipped");
}

// ── Stage definitions ────────────────────────────────────────

interface StageDefinition {
  stage_number: number;
  stage_name: string;
  stage_description: string;
}

const SUBJECTS: Record<string, StageDefinition[]> = {
  algebra: [
    { stage_number: 1, stage_name: "Variables & Expressions", stage_description: "What is a variable, writing expressions" },
    { stage_number: 2, stage_name: "Order of Operations", stage_description: "PEMDAS, evaluating expressions" },
    { stage_number: 3, stage_name: "One-Step Equations", stage_description: "Solving x + 3 = 7, 2x = 10" },
    { stage_number: 4, stage_name: "Two-Step Equations", stage_description: "Solving 2x + 3 = 11" },
    { stage_number: 5, stage_name: "Multi-Step Equations", stage_description: "Variables on both sides" },
    { stage_number: 6, stage_name: "Inequalities", stage_description: "Solving and graphing inequalities" },
    { stage_number: 7, stage_name: "Linear Functions", stage_description: "Slope, y-intercept, slope-intercept form" },
    { stage_number: 8, stage_name: "Systems of Equations", stage_description: "Substitution and elimination" },
    { stage_number: 9, stage_name: "Polynomials", stage_description: "Adding, subtracting, multiplying" },
    { stage_number: 10, stage_name: "Quadratics & Factoring", stage_description: "Factoring trinomials, quadratic formula" },
  ],
  biology: [
    { stage_number: 1, stage_name: "Cell Structure", stage_description: "Cell parts and their functions" },
    { stage_number: 2, stage_name: "Cell Processes", stage_description: "Photosynthesis, respiration, mitosis" },
    { stage_number: 3, stage_name: "Genetics", stage_description: "DNA, genes, heredity, Punnett squares" },
    { stage_number: 4, stage_name: "Evolution", stage_description: "Natural selection, adaptation, speciation" },
    { stage_number: 5, stage_name: "Ecology", stage_description: "Ecosystems, food webs, biomes" },
    { stage_number: 6, stage_name: "Human Body Systems", stage_description: "Major organ systems" },
    { stage_number: 7, stage_name: "Microorganisms", stage_description: "Bacteria, viruses, fungi" },
    { stage_number: 8, stage_name: "Biotechnology", stage_description: "GMOs, CRISPR, cloning concepts" },
  ],
  us_history: [
    { stage_number: 1, stage_name: "Colonial America", stage_description: "Settlement, colonies, colonial life" },
    { stage_number: 2, stage_name: "American Revolution", stage_description: "Causes, key events, founding documents" },
    { stage_number: 3, stage_name: "Early Republic", stage_description: "Constitution, Bill of Rights, early presidents" },
    { stage_number: 4, stage_name: "Expansion & Reform", stage_description: "Westward expansion, slavery, reform movements" },
    { stage_number: 5, stage_name: "Civil War", stage_description: "Causes, major battles, key figures" },
    { stage_number: 6, stage_name: "Reconstruction & Gilded Age", stage_description: "Reconstruction, industrialization" },
    { stage_number: 7, stage_name: "Progressive Era & WWI", stage_description: "Reforms, World War I, 1920s" },
    { stage_number: 8, stage_name: "Great Depression through WWII", stage_description: "Depression, New Deal, WWII" },
  ],
  chemistry: [
    { stage_number: 1, stage_name: "Matter & Atoms", stage_description: "States of matter, atomic structure" },
    { stage_number: 2, stage_name: "Periodic Table", stage_description: "Elements, periods, groups, trends" },
    { stage_number: 3, stage_name: "Chemical Bonding", stage_description: "Ionic, covalent, metallic bonds" },
    { stage_number: 4, stage_name: "Chemical Reactions", stage_description: "Types of reactions, balancing equations" },
    { stage_number: 5, stage_name: "Stoichiometry", stage_description: "Mole concept, limiting reagents" },
    { stage_number: 6, stage_name: "Gases", stage_description: "Gas laws, kinetic molecular theory" },
    { stage_number: 7, stage_name: "Acids & Bases", stage_description: "pH scale, neutralization reactions" },
    { stage_number: 8, stage_name: "Organic Chemistry", stage_description: "Carbon compounds, functional groups" },
  ],
};

// ── Supabase helpers ─────────────────────────────────────────

async function supabaseRequest(
  endpoint: string,
  method: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${endpoint}: ${res.status} — ${text}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Lesson text generation (Gemini) ─────────────────────────

async function generateLessonText(
  stageName: string,
  subject: string
): Promise<string> {
  const subjectLabel = subject === "us_history" ? "US History" : subject.charAt(0).toUpperCase() + subject.slice(1);
  const prompt = `Write a 3-4 sentence lesson introduction for a student learning ${stageName} in ${subjectLabel}. Be clear, engaging, and educational. No markdown, plain text only.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text.trim();
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("🔧 Seeding learning paths...\n");

  // First, clear existing data to avoid conflicts on re-run
  console.log("Clearing existing learning_paths...");
  await supabaseRequest(
    "learning_paths?subject=in.(algebra,biology,us_history,chemistry)",
    "DELETE"
  );

  const allRows: {
    subject: string;
    stage_number: number;
    stage_name: string;
    stage_description: string;
    lesson_text: string | null;
    total_stages: number;
  }[] = [];

  // Build rows
  for (const [subject, stages] of Object.entries(SUBJECTS)) {
    for (const stage of stages) {
      allRows.push({
        subject,
        stage_number: stage.stage_number,
        stage_name: stage.stage_name,
        stage_description: stage.stage_description,
        lesson_text: null,
        total_stages: stages.length,
      });
    }
  }

  // Insert all stages
  console.log(`Inserting ${allRows.length} stages...`);
  const inserted = await supabaseRequest("learning_paths", "POST", allRows);
  console.log(`✅ Inserted ${inserted.length} stages\n`);

  // Generate lesson text if API key is available
  if (GEMINI_API_KEY) {
    console.log("Generating lesson text with Gemini Flash...\n");

    for (const row of inserted) {
      try {
        const lessonText = await generateLessonText(
          row.stage_name,
          row.subject
        );
        await supabaseRequest(
          `learning_paths?id=eq.${row.id}`,
          "PATCH",
          { lesson_text: lessonText }
        );
        console.log(`  ✅ ${row.subject} #${row.stage_number}: ${row.stage_name}`);
      } catch (err) {
        console.error(
          `  ❌ ${row.subject} #${row.stage_number}: ${(err as Error).message}`
        );
      }
    }
    console.log("\n✅ Lesson text generation complete");
  } else {
    console.log("⚠️  Skipping lesson text (no GEMINI_API_KEY)");
  }

  console.log("\n🎉 Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
