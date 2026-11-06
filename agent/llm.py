"""LLM backends. All open-source / self-hosted. No API keys required."""
import json, os, re, urllib.request


def _post(url, payload, headers=None, timeout=300):
    req = urllib.request.Request(url, json.dumps(payload).encode(), {"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


class OllamaLLM:
    """Ollama (https://ollama.com) runs Llama 3, Qwen, Mistral, DeepSeek-R1 locally."""
    def __init__(self, host=None, model=None):
        self.host = (host or os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")).rstrip("/")
        self.model = model or os.environ.get("FORGE_MODEL", "llama3.1:8b")

    def chat(self, messages):
        out = _post(self.host + "/api/chat", {"model": self.model, "messages": messages, "stream": False})
        text = out["message"]["content"]
        return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()  # strip DeepSeek-R1 reasoning


class OpenAICompatLLM:
    """Any OpenAI-compatible server you host: llama.cpp, vLLM, LM Studio, LocalAI."""
    def __init__(self, base=None, model=None, key=None):
        self.base = (base or os.environ.get("FORGE_LLM_BASE", "http://127.0.0.1:8080/v1")).rstrip("/")
        self.model = model or os.environ.get("FORGE_MODEL", "local")
        self.key = key or os.environ.get("FORGE_LLM_KEY", "none")

    def chat(self, messages):
        out = _post(self.base + "/chat/completions", {"model": self.model, "messages": messages},
                    {"Authorization": "Bearer " + self.key})
        return re.sub(r"<think>.*?</think>", "", out["choices"][0]["message"]["content"], flags=re.S).strip()


class MockLLM:
    """Deterministic stand-in used by the tests. Not intelligent."""
    def chat(self, messages):
        last = messages[-1]["content"]
        if last.startswith("OBSERVATION"):
            return "Tool result received: " + last[:300]
        m = re.search(r"search:\s*(.+)", last)
        if m:
            return "TOOL: web_search " + json.dumps({"query": m.group(1).strip()})
        if "remember-test" in last:
            return 'Noted. <remember kind="preference" key="test_pref">likes tests</remember>'
        return "mock reply: " + last[:200]


def make_llm():
    kind = os.environ.get("FORGE_LLM", "ollama").lower()
    return {"ollama": OllamaLLM, "openai": OpenAICompatLLM, "mock": MockLLM}[kind]()
