# administrative-reform-simulator

Interactive simulator of administrative consolidation for Romania's 3,186 UATs. Deterministic, explainable, runs entirely in the browser. An analysis instrument for public debate.

## Commands

| Task | Command |
|---|---|
| test | `python3 -m unittest discover -s tests` |

## How this repo is gated

- `dev` is the default branch and where work lands. Pull requests are required, and **no status check is required yet**.
- `main` is production. It is restricted: only an admin can advance it, so an agent can open a pull request against it but cannot merge one.
- This repo ships GitHub Pages. That fires on a merge to `main`, which is the restricted branch — so an agent's work reaching `dev` deploys nothing.

## Working rules

- Branch from `dev` with an approved prefix: `feat/`, `fix/`, `chore/`, `docs/`,
  `sec/`, `adr/`. Land back into `dev` through a pull request.
- Conventional Commits. Imperative subject, lower case, no trailing full stop,
  72 characters hard limit. The body explains *why*; the diff already shows what.
- Never modify vendored third-party sources. Fix the environment instead.
- Secrets come from 1Password at runtime via `op run` and `op://` references.
  Never write a credential into a file, a commit, or a shell history line.
- Verify before claiming completion. A merged pull request is not a deployment,
  and a git tag is not a publication.

Cross-repo policy lives in `cnw-platform-handbook/docs/engineering-operating-model.md`.
