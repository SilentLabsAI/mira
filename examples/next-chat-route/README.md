# Next.js Chat Route Example

Production-style server route for wiring MIRA into a backend conversational AI flow.

This mirrors the original internal server flow:

1. Receive the user message on the backend.
2. Call `brain.retrieveContext(...)`.
3. Build the model system prompt with `buildMiraPrompt(...)`.
4. Generate the assistant response.
5. Call `brain.processTurn(...)` after generation.

Do not manually insert raw messages if you call `processTurn(...)`; MIRA stores the user and assistant messages there.

Keep this route server-side. It uses `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
