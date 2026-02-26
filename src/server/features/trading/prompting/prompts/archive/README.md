# Prompt Archive Policy

This directory stores historical and non-active prompt variants.

## Rules

- Files in `archive/` are reference-only and must not be imported in runtime paths.
- Active runtime prompt variants must live in the parent `prompts/` directory and be wired through `variants.ts`.
- When retiring a prompt, move it into `archive/` without preserving runtime imports.
- Keep strategy naming explicit and avoid generic names like `old` for active hierarchy folders.

## Validation

- `rg "prompts/archive|prompts/old" src/server -n` should show no runtime imports from archived prompts.