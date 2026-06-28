# CLI Docs

The local CLI imports, searches, opens, backs up, and exposes RecallBase data to local agents.

## Code Map

- Entry point: `apps/cli/src/cli.ts`
- Commands: `apps/cli/src/commands/*`
- Native browser bridge: `apps/cli/src/commands/extension-host.ts`
- Native host install/verify: `apps/cli/src/commands/extension-install.ts`
- MCP server: `apps/cli/src/mcp/*`
- Human and JSON output: `apps/cli/src/output/*`

## Related Docs

- Agent integration: `../agent-skill/usage.md`
- Release packaging: `../release/platforms.md`
- Runtime agent skill: `../../agent/recallbase/SKILL.md`
- Browser extension project: `../../../RecallBase-Extension`

When CLI commands, JSON shape, or command semantics change, update `../../agent/recallbase/SKILL.md`.
