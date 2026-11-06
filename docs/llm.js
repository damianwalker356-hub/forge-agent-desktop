// Model backends. The only language model in this application is the one the owner builds on the Train page
// (see learning-worker.js). No third-party model, CDN or service is loaded.

// Deterministic stand-in for tests (?mock=1). Not intelligent.
export class MockLLM {
  async chat(messages, onToken) {
    const last = messages[messages.length - 1].content;
    let out;
    if (last.startsWith("OBSERVATION")) out = "Tool result received: " + last.slice(0, 200);
    else if (/lookup:/.test(last)) out = "TOOL: wiki_search " + JSON.stringify({ query: last.split("lookup:")[1].trim() });
    else if (last.includes("remember-test")) out = 'Noted. <remember kind="preference" key="test_pref">likes tests</remember>';
    else out = "mock reply: " + last.slice(0, 160);
    if (onToken) onToken(out);
    return out;
  }
}
