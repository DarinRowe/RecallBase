# RecallBase

> Give any AI agent instant access to your conversation history—across agents and web AI, all stored locally.

[![npm](https://img.shields.io/npm/v/recallbase)](https://www.npmjs.com/package/recallbase)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-blue?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/ai-chat-exporter-archive/fapgpimjelmfedlapidmfljcpmenmjeb)
[![Microsoft Edge Add-ons](https://img.shields.io/badge/Edge-Add--ons-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ai-chat-exporter-archiv/gnlcemcmimkbgmnlclipknjjghllfdac)
[![CI](https://img.shields.io/github/actions/workflow/status/DarinRowe/RecallBase/ci.yml?label=CI)](https://github.com/DarinRowe/RecallBase/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![macOS · Linux · Windows](https://img.shields.io/badge/platform-macOS%20·%20Linux%20·%20Windows-blue)](https://recallbase.net/docs/install-cli/)

[Product](https://recallbase.net/desktop-cli/) · [Install the CLI](https://recallbase.net/docs/install-cli/) · [Developer resources](https://recallbase.net/developers/) · [Contributing](CONTRIBUTING.md)

> **Your data stays local.** No account required. Raw transcripts never leave your machine. [Full privacy details →](#privacy)

> **Early release:** RecallBase is usable today, but import coverage and packaging are still evolving. Keep backups of irreplaceable source histories.

---

## Install

**[Read the complete CLI installation guide →](https://recallbase.net/docs/install-cli/)**

### Requirements

- Node.js 22 or newer, with npm, for the recommended npm installation
- macOS, Linux, or Windows

The local CLI does not require a RecallBase account or cloud service.

### Get Started in 60 Seconds

```bash
npm install -g recallbase

rb --help    # verify the installation
rb import    # scan all known local sources
rb today     # what did you work on today?
```

That's it. No login, no config, no cloud. For alternative installation methods, `PATH` setup, and troubleshooting, use the [installation guide](https://recallbase.net/docs/install-cli/).

---

## The Problem

You use multiple AI tools every day — coding agents in the terminal, AI chat in the browser, different models for different tasks. But each one lives in its own silo:

- A **tool update** silently wipes your local agent session history
- An **account reset** and your ChatGPT conversations are gone
- You switch machines and your history **doesn't follow**
- You start a new session and spend the first 10 minutes **re-explaining everything**
- You ask an agent to continue yesterday's work, and it **has no idea what yesterday was**

The history exists — scattered across local files, browser tabs, and cloud accounts. But it's unreachable when you need it.

---

## What RecallBase Does

RecallBase pulls all of that history into a single local index, then makes it retrievable in under 200ms — for you, and for any agent you're working with.

```
rb import        # scan all known sources, incrementally
rb today         # what did I work on today?
rb search "jwt retry logic"   # find any conversation by topic
rb open <id>     # read a specific session in full
rb sources       # check which sources are healthy
rb backup        # export everything to JSON
```

No login required. Your data never leaves your machine.

---

## How It Compares

|                                   | RecallBase | mem0 | Rewind | Manual export |
| --------------------------------- | :--------: | :--: | :----: | :-----------: |
| Works fully offline / local-first |     ✅     |  ❌  |   ✅   |      ✅       |
| Covers CLI agents + browser AI    |     ✅     |  ❌  |   ❌   |      ❌       |
| MCP server built-in               |     ✅     |  ❌  |   ❌   |      ❌       |
| Sub-200ms local search            |     ✅     |  —   |   —    |       —       |
| No subscription required          |     ✅     |  ❌  |   ❌   |      ✅       |
| Import from official exports      |     ✅     |  ❌  |   ❌   |      ✅       |

---

## The Agent Experience

This is what RecallBase is actually for.

You open a new terminal, start a fresh agent, and ask:

> **"What did I work on today?"**

Without RecallBase, the agent has no idea. You scroll through four different apps and piece it together yourself.

With RecallBase:

```
You: What did I work on today?

Agent: This morning you debugged the OAuth token refresh loop in the edge
       service — you traced it to a race condition and left a TODO to add
       exponential backoff. After lunch, you reviewed the importer contract for
       Claude Code and added fixture tests for the cursor-based deduplication
       logic. You ended the day opening a PR for the MCP sources tool. The
       exponential backoff TODO is still open.
```

The agent called `rb today --json` in the background. No manual context-setting. No copy-pasting chat logs. Just continuity.

The same works mid-task. When an agent needs to find a prior decision:

```
Agent calls: rb search "exponential backoff" --json
→ Returns the exact conversation, with context, in milliseconds.
```

### MCP Integration

Add RecallBase as an MCP server to any agent that supports it — Cursor, Claude Desktop, GitHub Copilot, Zed, Windsurf, and more:

```json
{
  "mcpServers": {
    "recallbase": {
      "command": "rb",
      "args": ["mcp"]
    }
  }
}
```

The agent gains four tools: `today`, `search`, `open`, and `sources`. The MCP server starts in milliseconds, has no external dependencies, and runs entirely locally — no API key, no rate limits.

### Agent Skill

The portable Agent Skills package lives in [`skills/recallbase/`](skills/recallbase/). Install it globally with the [`skills` CLI](https://github.com/vercel-labs/skills) so RecallBase is available across projects:

```bash
npx skills add DarinRowe/RecallBase --global
```

Update the global installation later with:

```bash
npx skills update recallbase --global
```

---

## Supported Sources

### Agents

| Source                          | Status       |
| ------------------------------- | ------------ |
| OpenAI Codex CLI + ChatGPT app | ✅ Core      |
| Claude Code                     | ✅ Core      |
| Cursor Desktop + Agent CLI      | ✅ Supported |
| GitHub Copilot                  | ✅ Supported |
| Grok Build                      | ✅ Supported |
| Kimi Code                       | ✅ Supported |
| OpenCode                        | ✅ Supported |

### Web AI - Browser Extension

The browser extension captures conversations from web AI tools. It can quick-export the current conversation to Markdown or Obsidian, or open Export Studio to preview the full conversation, select messages, choose width/theme, and export Markdown, Obsidian, image, or text. RecallBase local import still uses the native messaging host. No cloud upload happens by default.

| ChatGPT | Claude | Gemini | DeepSeek | Grok | Perplexity |
| :-----: | :----: | :----: | :------: | :--: | :--------: |
|    ✓    |   ✓    |   ✓    |    ✓     |  ✓   |     ✓      |

| Kimi | Qwen | Doubao | Tencent Yuanbao | NotebookLM | Google AI Studio | GitHub Copilot | Microsoft Copilot |
| :--: | :--: | :----: | :-------------: | :--------: | :--------------: | :------------: | :---------------: |
|  ✓   |  ✓   |   ✓    |        ✓        |     ✓      |        ✓         |       ✓        |         ✓         |

## Privacy

RecallBase is **local-first by design**:

- All data is stored on your machine in a SQLite database
- No account required for any local feature
- Raw transcripts never leave your machine

---

## Optional: Archive Web AI Chats

[Install the browser extension →](https://recallbase.net/docs/install-browser-extension/)

The browser extension is a separate, optional product surface for saving conversations from supported web AI apps. Its installation and browser-specific setup live in the website documentation so they stay current without duplicating them here.

To make extension captures available to the local CLI and agents, install and verify the native messaging host once:

```bash
# Install the native messaging host (required once)
rb extension install-host
rb extension verify-host
```

The native messaging host is only required for RecallBase import and agent access. For CLI installation and general troubleshooting, see the [CLI installation guide](https://recallbase.net/docs/install-cli/).

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, guidelines, and how to submit changes. Please also read our [Code of Conduct](CODE_OF_CONDUCT.md).

Quick start:

```bash
bun install
bun run typecheck
bun test
```

See [docs/README.md](docs/README.md) for architecture notes, importer contracts, and fixture guidelines. If a compiled binary fails SQLite/FTS smoke checks, see [docs/release/platforms.md](docs/release/platforms.md).

## License

RecallBase is released under the [MIT License](LICENSE).
