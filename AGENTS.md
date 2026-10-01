# administrative-reform-simulator: historical source and redirect

The maintained application lives in [romania-reforms/simulators/administrativ](https://github.com/CristianNichifor/romania-reforms/tree/dev/simulators/administrativ). Direct feature, engine and data work there. This repository retains historical source; ordinary maintenance here covers `redirect/`, links and historical documentation.

## Verify

Node 22 or later: `node --test tests/redirect.test.cjs`. No installation, credentials, browser download or live service is required. This executes the deployed redirect's script and checks both fallback destinations. `.github/workflows/redirect-check.yml` exposes the `verify` check.

Preserve query strings and scenario hashes in the JavaScript redirect. The no-JavaScript fallback intentionally opens the canonical home page without them. The Pages workflow must continue to publish only `redirect/`; do not restore the historical app as a second maintained product.

Historical source changes require an explicit historical-maintenance task and the existing language-specific CI checks. See their workflow commands rather than using unittest as a substitute for pytest.

## Contribution workflow

- Work from the remote default branch in a separate checkout. With the maintainer's `wt` tool, run `git fetch origin` then `wt new chore/<task> origin/dev`; it creates `<repo>/.worktrees/chore/<task>`. Contributors without `wt` can use a separate clone and feature branch. Never modify another task's working tree.
- Use Conventional Commits: imperative lower-case subject, at most 72 characters, no trailing full stop, one change per commit. Explain why in the body only when needed; link issues with `Refs: #N` or `Closes: #N`.
- Open a PR against `dev` with the problem, resulting behavior, verification command/results and any limitations. Agents never merge PRs, push directly to protected branches, deploy, or publish releases.
- A required check or administrator-only branch rule is not an agent permission boundary: administrator credentials can bypass rules. Keep publication credentials out of ordinary development.
- Tasks need an observable acceptance criterion, affected area, constraints and a verification command. Use synthetic fixtures; do not include credentials or personal data in issues, logs or tests.
