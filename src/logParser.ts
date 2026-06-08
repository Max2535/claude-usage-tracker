import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { UsageTracker } from './usageTracker';

function getLogDirectory(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'Claude', 'logs');
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'logs');
    default:
      return path.join(os.homedir(), '.claude', 'logs');
  }
}

interface ClaudeLogEntry {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  model?: string;
  timestamp?: string;
}

export class LogParser {
  private tracker: UsageTracker;
  private watchers: fs.FSWatcher[] = [];
  private seenIds = new Set<string>(); // prevent duplicate ingestion
  private logDir: string;

  constructor(tracker: UsageTracker) {
    this.tracker = tracker;
    this.logDir = getLogDirectory();
  }

  start(): void {
    const config = vscode.workspace.getConfiguration('claudeUsageTracker');
    if (!config.get<boolean>('enableAutoIntercept', true)) return;

    if (!fs.existsSync(this.logDir)) {
      console.log(`[ClaudeUsageTracker] Log directory not found: ${this.logDir}`);
      return;
    }

    // Parse existing files on startup
    this.parseAllFiles();

    // Watch for new/modified JSONL files
    const watcher = fs.watch(this.logDir, { persistent: false }, (event, filename) => {
      if (filename && filename.endsWith('.jsonl')) {
        this.parseFile(path.join(this.logDir, filename));
      }
    });

    this.watchers.push(watcher);
    console.log(`[ClaudeUsageTracker] Watching logs: ${this.logDir}`);
  }

  private parseAllFiles(): void {
    try {
      const files = fs.readdirSync(this.logDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        this.parseFile(path.join(this.logDir, file));
      }
    } catch (err) {
      console.error('[ClaudeUsageTracker] Error reading log directory:', err);
    }
  }

  private parseFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const entry: ClaudeLogEntry = JSON.parse(line);
          if (!entry.usage?.input_tokens && !entry.usage?.output_tokens) continue;

          // Use file+line hash as dedup key
          const dedupKey = `${filePath}:${line.substring(0, 64)}`;
          if (this.seenIds.has(dedupKey)) continue;
          this.seenIds.add(dedupKey);

          this.tracker.record(
            entry.model ?? 'unknown',
            entry.usage.input_tokens ?? 0,
            entry.usage.output_tokens ?? 0,
            'log-parser',
            entry.timestamp
          );
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      // File may be locked or deleted — ignore
    }
  }

  dispose(): void {
    for (const w of this.watchers) {
      try { w.close(); } catch {}
    }
    this.watchers = [];
  }
}
