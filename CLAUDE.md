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
- **LogParser** (`logParser.ts`) — watches the Claude log dir for `.jsonl` files, parses usage lines, feeds `tracker.record(...)`. Dedup is in-memory only (`seenIds` Set), so duplicates re-ingest across restarts.
- **DashboardPanel** (`dashboard/DashboardPanel.ts`) — webview. Pushes data to `dashboard/dashboard.html` via `postMessage`, receives `refresh`/`exportCSV`/`clearHistory` back.

Data flow: source (manual / log-parser) → `tracker.record()` → cost computed by `costCalculator.calculateCostUSD()` → stored → StatusBar + Dashboard read back. After any mutation, call sites must manually call `statusBar.refresh()` and `DashboardPanel.currentPanel?.update()` — there is no event bus.

## Gotchas

- **dashboard.html is NOT copied to `out/`.** `tsc` only emits `.ts`. `DashboardPanel.setHtml()` and `extension.ts` read the template from `src/dashboard/dashboard.html` at runtime. Packaging that strips `src/` breaks the dashboard. If you change build output, copy the html.
- **`UsageRecord.source` enum drift.** Type is `'manual' | 'log-parser' | 'api-intercept'`, but `extension.ts` records `'api-intercept'` for the programmatic `recordUsage` payload while `logParser.ts` uses `'log-parser'`. Keep the union in `usageTracker.ts` in sync with actual call-site strings.
- **Pricing is hardcoded** in `costCalculator.ts` (`PRICING` map, per 1M tokens). Model match is substring `.toLowerCase().includes(k)`; unknown models fall back to Sonnet pricing. Update this map when Anthropic changes prices or adds models.
- **Only last 7 days** are surfaced — `getLast7Days()`, CSV export, and dashboard all window to 7 days, but `globalState` retains older keys until `clearAll()`.
- **`uuid` dep is overkill** but currently used for `UsageRecord.id`.

## Config (contributes in package.json)

`enableAutoIntercept`, `showStatusBar`, `currency` (USD|THB), `thbRate`. Currency formatting lives in `costCalculator.formatCost()`.
