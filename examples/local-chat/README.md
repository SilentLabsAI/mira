# Local Chat Verification

Quick local verification for calling MIRA core with your own OpenAI and Supabase keys.

For a backend route, use `examples/next-chat-route`. This CLI path is only for checking the memory loop locally.

## Setup

From the repo root:

```bash
npm install
cp .env.example .env
```

Fill `.env` with your own values, then apply:

```text
packages/mira-supabase/schema/memory_schema.sql
```

## Run

```bash
npx tsx examples/local-chat/demo.ts "Remember that I prefer concise answers."
```

The demo passes explicit `MIRA_USER_ID` and `MIRA_THREAD_ID` values. The core now requires a caller/user id instead of assuming a shared development user.

## What To Replace

- Replace CLI input with your app's message input.
- Replace demo UUIDs with your authenticated user/thread ids.
- Replace the direct OpenAI call with your app's model gateway if needed.
- For a server route, start from `examples/next-chat-route`.
- Keep `.env` local and never commit real service keys.
