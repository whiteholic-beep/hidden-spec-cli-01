# hidden-spec-cli-01

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/whiteholic-beep/hidden-spec-cli-01/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/whiteholic-beep/hidden-spec-cli-01/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend — one command-line tool that applies the edits AI models write, in four formats (unified diffs with wrong line numbers, SEARCH/REPLACE blocks, V4A patches, text-editor tool calls as JSON), to a tree of files, exactly as SPEC.md says. Three-tier fuzzy matching absorbs whitespace and indentation drift; application is atomic and all-or-nothing. Practice checks: 100/100.

## Run it

```sh
node main.ts [options] [PATCH]
```

A check is one run: its arguments, its standard input (or none) and the files it starts with. It passes when the exit code, everything written to stdout and every file afterwards are exactly what SPEC.md says.

---

<sub>Entered on [make.fun](https://make.fun/?ref=zx2vqcpc&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
