# Claude Usage Tracker

A VS Code extension that tracks Anthropic Claude API token usage locally — no external services required.

## Features

- **Status Bar** — Live token count + cost estimate in the bottom bar
- **Usage Dashboard** — Webview panel with 7-day chart and per-call breakdown
- **Auto Log Parser** — Watches Claude Code JSONL logs and ingests usage automatically
- **Manual Recording** — Record usage programmatically via command or API
- **CSV Export** — Export full history to CSV
- **Multi-currency** — Display costs in USD or THB

## Usage

### Status Bar
Click the `⚡ Claude: Xk (...)` item in the status bar to open the dashboard.

### Commands (`Ctrl+Shift+P`)
| Command | Description |
|---|---|
| `Claude Usage: Show Dashboard` | Open usage dashboard |
| `Claude Usage: Record Usage` | Manually record a usage entry |
| `Claude Usage: Clear All History` | Wipe all stored data |
| `Claude Usage: Export CSV` | Save 7-day history as CSV |

### Record Usage Programmatically
From another extension or script:
```typescript
await vscode.commands.executeCommand('claudeUsageTracker.recordUsage', {
  model: 'claude-sonnet-4',
  inputTokens: 1500,
  outputTokens: 800,
  timestamp: new Date().toISOString(), // optional
});
```

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `claudeUsageTracker.enableAutoIntercept` | boolean | `true` | Watch Claude Code log files |
| `claudeUsageTracker.showStatusBar` | boolean | `true` | Show status bar item |
| `claudeUsageTracker.currency` | `USD`\|`THB` | `USD` | Display currency |
| `claudeUsageTracker.thbRate` | number | `33` | USD→THB exchange rate |

## Log File Locations (Auto-detected)

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Claude\logs\` |
| macOS | `~/Library/Application Support/Claude/logs/` |
| Linux | `~/.claude/logs/` |

## Token Pricing (per 1M tokens)

| Model | Input | Output |
|---|---|---|
| claude-opus-4 | $15.00 | $75.00 |
| claude-sonnet-4 | $3.00 | $15.00 |
| claude-haiku-4 | $0.80 | $4.00 |

## Development

```bash
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

## License
MIT
