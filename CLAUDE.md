# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VS Code extension. Tracks Anthropic Claude API token usage **locally** — no external services, no network. Data lives in VS Code `globalState`.

## Commands

```bash
npm install
npm run compile      # tsc -p ./  → emits to out/
npm run watch        # tsc -watch, for iterative dev
npm run lint         # eslint src --ext ts
```

Run/debug: press **F5** in VS Code to launch Extension Development Host. No test suite exists.

## Architecture

Activation (`onStartupFinished`) wires four singletons in `src/extension.ts`:

- **UsageTracker** (`usageTracker.ts`) — single source of truth. Persists per-day `DailyUsage` blobs to `globalState` under key `claudeUsage_<YYYY-MM-DD>`. All reads/writes go through it. Owns the `UsageRecord` shape and CSV export.
- **StatusBarManager** (`statusBar.ts`) — renders today's total in the status bar, polls every 30s via `setInterval`.
- **LogParser** (`logParser.ts`) — recursively watches `~/.claude/projects/**/*.jsonl` (Claude Code transcripts, all platforms), reads nested `message.usage` / `message.model`, feeds `tracker.record(...)`. Dedup keys (`entry.uuid`/`requestId`) are persisted to `globalState` under `claudeUsage_seenIds`, so restarts don't double-count. Takes `(tracker, context)`.
- **DashboardPanel** (`dashboard/DashboardPanel.ts`) — webview. Pushes data to `dashboard/dashboard.html` via `postMessage`, receives `refresh`/`exportCSV`/`clearHistory` back.

Data flow: source (manual / log-parser) → `tracker.record()` → cost computed by `costCalculator.calculateCostUSD()` → stored → StatusBar + Dashboard read back. After any mutation, call sites must manually call `statusBar.refresh()` and `DashboardPanel.currentPanel?.update()` — there is no event bus.

## Gotchas

- **dashboard.html is NOT copied to `out/`.** `tsc` only emits `.ts`. `DashboardPanel.setHtml()` and `extension.ts` read the template from `src/dashboard/dashboard.html` at runtime. Packaging that strips `src/` breaks the dashboard. If you change build output, copy the html.
- **`UsageRecord.source` enum drift.** Type is `'manual' | 'log-parser' | 'api-intercept'`, but `extension.ts` records `'api-intercept'` for the programmatic `recordUsage` payload while `logParser.ts` uses `'log-parser'`. Keep the union in `usageTracker.ts` in sync with actual call-site strings.
- **Pricing is hardcoded** in `costCalculator.ts` (`PRICING` map, per 1M tokens). Model match is substring `.toLowerCase().includes(k)`; unknown models fall back to Sonnet pricing. Update this map when Anthropic changes prices or adds models.
- **Only last 7 days** are surfaced — `getLast7Days()`, CSV export, and dashboard all window to 7 days, but `globalState` retains older keys until `clearAll()`.
- **`clearAll()` also wipes `seenIds`** — the dedup key `claudeUsage_seenIds` shares the `claudeUsage_` prefix, so Clear History resets dedup. In-memory `seenIds` isn't cleared until restart, so re-ingestion of old lines only resumes after reload.
- **Cache tokens folded into input** — LogParser sums `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Anthropic prices cache reads cheaper, so cost estimates run high. `<synthetic>` model entries fall back to Sonnet pricing.
- **`uuid` dep is overkill** but currently used for `UsageRecord.id`.

## Config (contributes in package.json)

`enableAutoIntercept`, `showStatusBar`, `currency` (USD|THB), `thbRate`. Currency formatting lives in `costCalculator.formatCost()`.
