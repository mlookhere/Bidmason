# Chat FreePT CI operating policy

Agent: ChatGPT with connected GitHub tools only. Never invoke Claude, Claude Code or custom Claude action. `main` is production; `dev` integration. Branches `work/<issue>-<slug>`; PRs into `dev`. No required gate may count skipped, missing, pending or zero checks as successful. Inspect Actions logs on failure, repair causal failures, and keep the control Issue current. `./scripts/bootstrap --ci` installs only noninteractive dependencies; `./ci/run fast|pr|security` exits nonzero on failed checks. No tokens or live customer data committed.

The reference CI repository includes substantial Claude-exclusive machinery (hooks, workflow reviews, CLI orchestration) deliberately **not** vendored. Its runtime-neutral stage semantics and the supplied GPT-friendly archive inform this project's minimal headless runner. Future import must be reviewed file-by-file; all CI checks must execute on GitHub before certification.

## Windows native verification

The initial scaffold includes PowerShell entrypoints `./scripts/bootstrap.ps1 -CI` and `./ci/run.ps1 fast|pr|security|web`. The `win-fast` GitHub Actions job performs the original Python fast gates, locked npm install, TypeScript checking, web tests and Next production build on Windows. This job is required alongside the Linux fast, PR, security and web-build gates. Never assume Windows support from Linux-only success.
