# V7.1 Gateway changelog

- Replaced the OpenAI-only runtime with Netlify AI Gateway-aware OpenAI, Anthropic and Gemini adapters.
- Added cost-aware Coach routing: Luna for routine explanations, Terra for deep questions, Sol reserved for final adjudication.
- Added bounded cross-provider failover and in-provider model-not-found fallback.
- Distributed Decision Attack roles across OpenAI, Anthropic and Gemini.
- Replaced model-reported decision confidence with deterministic HADES conviction.
- Removed AI as a price authority; chart history remains Twelve Data / Finnhub only.
- Added provider-health diagnostics for Gateway and all three LLM providers.
- Added GitHub CI, deployment migration guidance, secret hygiene and rollback instructions.
