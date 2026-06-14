/**
 * Prompt-safety helpers — stop user-authored text from breaking OUT of the
 * delimiter it's embedded in inside an LLM prompt (a mild prompt-injection
 * vector). These are defense-in-depth: our system prompts already tell the
 * model not to follow instructions inside the delimited block, and outputs are
 * schema-validated, but neutralising the delimiter removes the breakout entirely.
 */

/**
 * Neutralise the open/close form of a delimiter tag inside user text so the text
 * cannot close (or re-open) the block it's embedded in. e.g. text destined for
 * `<syllabus>${text}</syllabus>` is run through neutralizeTag(text, "syllabus")
 * so a literal `</syllabus>` in the input can't escape the block. Case- and
 * whitespace-insensitive on the tag; replaces with a visible marker so the
 * content is still readable to the model.
 */
export function neutralizeTag(text: string, tag: string): string {
  if (!text) return text;
  // Matches <tag>, </tag>, <  tag >, </ tag > etc. for the specific tag name.
  const re = new RegExp(`<\\s*/?\\s*${tag}\\s*>`, "gi");
  return text.replace(re, `[${tag}]`);
}

/**
 * Collapse a string to a single safe inline token: no newlines (so it can't add
 * its own lines / instructions to a bulleted prompt context) and no runs of
 * whitespace. Use for user text embedded in a single `- ${value}` list line.
 */
export function inlineSafe(text: string): string {
  if (!text) return text;
  return text.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}
