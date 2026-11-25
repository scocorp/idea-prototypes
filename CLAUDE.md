# idea-prototypes

Quick prototypes of game and software ideas, one idea per top-level directory. Each prototype exists to
answer one question fast: is this idea fun / worth pursuing? Prefer iteration speed and clarity over
production robustness, but keep the code readable enough to keep building on if the answer is "yes".

## Conventions

- Each idea is self-contained in its own directory: its own toolchain, `CLAUDE.md` and `doc/`.
  There is no root package; don't add dependencies between ideas.
- Idea-specific details (design, rules, architecture, how to build/run/test) live in that idea's
  directory, never in this file. This file only indexes them.
- CI: one workflow per idea in `.github/workflows/`, path-filtered to that idea's directory.
- Commit trailers / PR text: no model identifiers.

## Ideas

| Directory | One-liner | Status |
|---|---|---|
| [`skyscraper/`](skyscraper/CLAUDE.md) | Isometric vertical city-builder: whatever you stack blocks the sun below it. | First playable prototype |
