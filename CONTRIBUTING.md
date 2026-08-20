# Contributing to RecallBase

Thanks for your interest in contributing.

## Getting Started

```bash
bun install
bun run typecheck
bun test
```

See [docs/README.md](docs/README.md) for architecture notes, importer contracts, and fixture guidelines.

## How to Contribute

1. Open an issue to discuss significant changes before writing code.
2. Fork the repository and create a branch for your change.
3. Make focused, minimal changes that preserve existing behavior.
4. Add or update tests for bug fixes and new features.
5. Run the full test suite and type checker before submitting.
6. Open a pull request with a clear description and reference any related issues.

## Guidelines

- Keep the CLI local-first and privacy-preserving.
- Do not add login or cloud-sync requirements to local features.
- Avoid heavy abstractions or new dependencies for small features.
- Update `skills/recallbase/SKILL.md` if you change CLI commands, JSON shapes, or command semantics.
- Follow the existing code style and formatting.

## Testing

```bash
bun test
bun run package:release:test
```

## Questions

For questions, open a discussion issue or refer to the documentation in `docs/`.
