// Parsing of model output into a tool call. DOM-free so it can be unit tested in Node.
export const TOOL_CALL = /^\s*\[tool:([a-z0-9][a-z0-9_-]{0,63})\]\s*(\{[\s\S]*\})\s*$/;
// Parses a model response such as `[tool:engine_displacement] {"bore_mm":86}`. Returns null for plain text.
export function parseToolCall(text) {
  const m = TOOL_CALL.exec(text || ''); if (!m) return null;
  // Take the first complete JSON object; the model may emit trailing bytes.
  let depth = 0, end = -1; const json = m[2];
  for (let i = 0; i < json.length; i++) { if (json[i] === '{') depth++; else if (json[i] === '}' && --depth === 0) { end = i + 1; break; } }
  if (end < 0) return { name: m[1], error: 'Unterminated JSON in tool call', raw: text };
  try { return { name: m[1], input: JSON.parse(json.slice(0, end)), raw: text }; } catch (e) { return { name: m[1], error: 'Invalid JSON in tool call: ' + e.message, raw: text }; }
}
