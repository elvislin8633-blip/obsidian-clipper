## Scripts

### Verify this fork

```bash
npm run verify
```

Runs unit tests, the locale CLI exit-code tests, TypeScript, the unused-string
scan, and Chrome/Firefox/Safari production builds. Unused-string candidates are
informational; missing or malformed locale source files fail the command.

Optional browser smoke (requires a separate Playwright installation with its
Chromium browser available):

```bash
node scripts/smoke-capture.cjs
```

If Playwright is outside this checkout, set `PLAYWRIGHT_MODULE` to its absolute
module directory. The smoke loads `dist/` in a disposable profile and serves a
local fixture. It checks action labels, daily-note routing, rejected handoffs,
and concurrent Research Queue writes. OS handoffs are intercepted: it does not
write to an Obsidian vault or touch an existing browser profile. Evidence is
saved to `output/playwright/`. Rebuild before running after source changes.

### Localization

First, add an OpenAI API key in `.env` at the root of the repo:

```
OPENAI_API_KEY=sk-...
```

Scripts can be run using npm in the root of the repo.

#### Update locale

```
npm run update-locales
```

- Checks the English locale file and automatically translates missing strings
- Reorganizes strings alphabetically

#### Add locale

```bash
npm run add-locale fr
```

### Version bump

```bash
./scripts/bump-version.sh 1.0.1
```

- Updates `version` in `package.json`, all browser manifests, and `dev/manifest.json`
- Updates `MARKETING_VERSION` in the Xcode project
- Increments `CURRENT_PROJECT_VERSION` by 1

### Changelog

```bash
./scripts/generate-changelog.sh
```

- Generates `changelogs/<version>.md` from commits since the last git tag
- Reads the version from `package.json`
- Commits starting with "fix" are grouped under an **Improved** section
- Version bump commits are excluded
