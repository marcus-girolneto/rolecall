# Rolecall Agent Permission Benchmark

Status: in progress (started 2026-10-20). Nothing here is published yet.

## Question

When a signed-in user talks to an open-source AI agent, can they get it to act on data or with powers their account
should not have? We measure it per agent, per tool, with Rolecall, and report which layer stopped each attempt:
the app's authorization code, the model's refusal, or nothing.

## Method

1. **Selection.** Popular open-source TypeScript apps whose AI assistant can call tools that read or change user data.
2. **Triage (read-only).** Read the source to list every model-callable tool, how identity reaches it, and what
   authorization it performs. No code from the project is installed or executed at this stage.
3. **Local harness.** Run the project's real tool code in-process against a local database with fictional data,
   two users (or two workspaces / roles), and Rolecall's permission table. Never against the project's hosted service.
4. **Checks per agent**
   - *Direct checks:* every tool called as each user/role with another user's record IDs (no model, deterministic).
   - *Conversations:* the project's own model setup where feasible, plus AI-generated attacks
     (`rolecall attacks`, DeepSeek V4.1 Flash via OpenRouter), replayed from recordings.
5. **Result per tool:** blocked by code · refused only by the model · executed (violation) · not checked.
6. **Evidence:** each run's Rolecall bundle (hashes, model ids, git SHA of the tested commit).

## Disclosure policy

- A suspected violation is first **reproduced** locally and checked by hand. Unconfirmed suspicions are never published.
- A confirmed violation is reported **privately** to the maintainers (GitHub Security Advisory or their published
  security contact) before anything is published.
- The public benchmark lists it as "reported, details embargoed" until it is fixed or **90 days** pass, whichever is
  first, unless the maintainers ask for more time with a reason.
- After that, the write-up credits the maintainers' response and names the fixed version.
- Results describe a specific commit tested locally; they are not a statement about anyone's hosted product.

## Agents

| Agent | Commit | Tools | Triage | Harness | Result |
|---|---|---|---|---|---|
| Rolecall demo (invoice agent, our own) | this repo | 3 | done | done | 1 planted violation found; 12/12 AI attacks held (Gemini 2.5 Flash Lite) |
| vercel/chatbot | c2f8235 | 5 | done: ownership checked in every document tool | S | – |
| aifa-agi/aifa | e4d0ea7 | 6 | done: suspected issue, unconfirmed (embargoed) | M | – |
| dubinc/dub | depth-1 clone | 6 | done: tools scoped to the session's workspaces | S | – |
| twentyhq/twenty | depth-1 clone | many | done: suspected issue, unconfirmed (embargoed) | M–L | – |
| elie222/inbox-zero | – | – | blocked (needs approval) | – | – |
| midday-ai/midday | – | – | blocked (needs approval) | – | – |

Triage notes live in `triage/` (git-ignored): they may contain unconfirmed suspicions about third-party code and never leave this machine until reviewed and disclosed.
