# `npx skills` installation research

Reviewed against `vercel-labs/skills` on 2026-08-20.

## Recommendation

Use the GitHub `owner/repo` shorthand. The CLI discovers the repository's single skill automatically:

```bash
npx skills add DarinRowe/RecallBase --global
```

`--global` installs at user scope rather than the default project scope; it is recommended here because RecallBase restores history across projects. The shorthand source and scope are documented in the official [source formats](https://github.com/vercel-labs/skills/blob/main/README.md#source-formats) and [installation scope](https://github.com/vercel-labs/skills/blob/main/README.md#installation-scope) sections.

`--skill recallbase` is currently optional because the repository contains one skill. It can make selection explicit if the repository gains more skills later:

```bash
npx skills add DarinRowe/RecallBase --skill recallbase --global
```

The flag is an explicit skill-name filter, while a single discovered skill is selected automatically; see the official [option table](https://github.com/vercel-labs/skills/blob/main/README.md#options) and [`src/add.ts`](https://github.com/vercel-labs/skills/blob/main/src/add.ts#L3228-L3323).

## Updates

Update an installation by skill name and the scope where it was installed:

```bash
# Global installation
npx skills update recallbase --global

# Project installation
npx skills update recallbase --project
```

Omitting the scope opens a scope prompt. The official [`skills update` documentation](https://github.com/vercel-labs/skills/blob/main/README.md#skills-update) defines named updates and the `--global`, `--project`, and `--yes` scope behavior.

## README wording

State separately that the skill requires the `rb` CLI on `PATH`; `npx skills add` installs the agent instructions, not the RecallBase executable. Keep the public README to the recommended global command and the global update command.
