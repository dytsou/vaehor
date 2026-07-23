#!/usr/bin/env bash
# CI dependency install: skip lifecycle scripts, then rebuild allow-listed native deps.
set -euo pipefail

pnpm install --frozen-lockfile --ignore-scripts

trusted=$(
  node -e "
    const fs = require('fs');
    const m = fs.readFileSync('pnpm-workspace.yaml', 'utf8').match(/^allowBuilds:\n((?:  .+\n)*)/m);
    if (!m) process.exit(1);
    console.log([...m[1].matchAll(/^  \"?([^\":]+)\"?:/gm)].map((x) => x[1]).join(' '));
  "
)
pnpm rebuild $trusted
