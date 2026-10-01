# Contributing

Current application issues and feature PRs belong in [romania-reforms](https://github.com/CristianNichifor/romania-reforms), under `simulators/administrativ`. Keep this repository's retained source historical.

For redirect/documentation fixes, use Node 22+, run `node --test tests/redirect.test.cjs`, and open a PR to `dev`. Include the original URL and expected destination, including a synthetic query/hash example. Deployment is a separate maintainer action from `main`.

## Contribution workflow

- Work from the remote default branch in a separate checkout. With the maintainer's `wt` tool, run `git fetch origin` then `wt new chore/<task> origin/dev`; it creates `<repo>/.worktrees/chore/<task>`. Contributors without `wt` can use a separate clone and feature branch. Never modify another task's working tree.
- Use Conventional Commits: imperative lower-case subject, at most 72 characters, no trailing full stop, one change per commit. Explain why in the body only when needed; link issues with `Refs: #N` or `Closes: #N`.
- Open a PR against `dev` with the problem, resulting behavior, verification command/results and any limitations. Agents never merge PRs, push directly to protected branches, deploy, or publish releases.
- A required check or administrator-only branch rule is not an agent permission boundary: administrator credentials can bypass rules. Keep publication credentials out of ordinary development.
- Tasks need an observable acceptance criterion, affected area, constraints and a verification command. Use synthetic fixtures; do not include credentials or personal data in issues, logs or tests.
