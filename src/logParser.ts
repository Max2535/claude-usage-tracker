import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { UsageTracker } from './usageTracker';

// Claude Code stores per-session transcripts as JSONL under ~/.claude/projects
// on every platform (Windows: C:\Users\<you>\.claude\projects).
function getLogDirectory(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeLogEntry {
  uuid?: string;
  requestId?: string;
  message?: {
    usage?: ClaudeUsage;
    model?: string;
  };
  timestamp?: string;
}

export class LogParser {
  private tracker: UsageTracker;
  private context: vscode.ExtensionContext;
  private watchers: fs.FSWatcher[] = [];
  // Dedup keys, persisted across restarts so re-reading files never double-counts.
  private seenIds: Set<string>;
  private logDir: string;
  private dirty = false;

  private static readonly SEEN_KEY = 'claudeUsage_seenIds';

  constructor(tracker: UsageTracker, context: vscode.ExtensionContext) {
    this.tracker = tracker;
    this.context = context;
    this.logDir = getLogDirectory();
    this.seenIds = new Set(context.globalState.get<string[]>(LogParser.SEEN_KEY, []));
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
    this.flushSeen();

    // Watch the whole tree (transcripts live in projects/<project>/*.jsonl)
    const watcher = fs.watch(this.logDir, { persistent: false, recursive: true }, (event, filename) => {
      if (filename && filename.endsWith('.jsonl')) {
        this.parseFile(path.join(this.logDir, filename));
        this.flushSeen();
      }
    });

    this.watchers.push(watcher);
    console.log(`[ClaudeUsageTracker] Watching logs: ${this.logDir}`);
  }

  private parseAllFiles(): void {
    try {
      for (const file of this.findJsonlFiles(this.logDir)) {
        this.parseFile(file);
      }
    } catch (err) {
      console.error('[ClaudeUsageTracker] Error reading log directory:', err);
    }
  }

  // Force a full re-scan on demand. Returns ingest stats so a command can
  // report concrete numbers instead of relying on (in)visible console logs.
  rescanNow(): { logDir: string; dirExists: boolean; files: number; newRecords: number } {
    const dirExists = fs.existsSync(this.logDir);
    if (!dirExists) {
      return { logDir: this.logDir, dirExists, files: 0, newRecords: 0 };
    }
    const files = this.findJsonlFiles(this.logDir);
    const before = this.seenIds.size;
    for (const f of files) this.parseFile(f);
    this.flushSeen();
    return { logDir: this.logDir, dirExists, files: files.length, newRecords: this.seenIds.size - before };
  }

  // Recursively collect *.jsonl under dir
  private findJsonlFiles(dir: string): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...this.findJsonlFiles(full));
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
    return out;
  }

  private parseFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const entry: ClaudeLogEntry = JSON.parse(line);
          const usage = entry.message?.usage;
          if (!usage) continue;

          // Total input = fresh + cache-write + cache-read tokens.
          // NOTE: cached tokens are priced differently by Anthropic; this is a
          // rough aggregate, so cost estimates run slightly high.
          const inputTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0);
          const outputTokens = usage.output_tokens ?? 0;
          if (inputTokens === 0 && outputTokens === 0) continue;

          // Stable dedup key: per-message uuid/requestId from the transcript.
          // Falls back to a file+line hash for entries lacking both.
          const dedupKey =
            entry.uuid ?? entry.requestId ?? `${filePath}:${line.substring(0, 64)}`;
          if (this.seenIds.has(dedupKey)) continue;
          this.seenIds.add(dedupKey);
          this.dirty = true;

          this.tracker.record(
            entry.message?.model ?? 'unknown',
            inputTokens,
            outputTokens,
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

  // Persist the dedup set so a restart does not re-ingest already-counted lines.
  private flushSeen(): void {
    if (!this.dirty) return;
    this.context.globalState.update(LogParser.SEEN_KEY, Array.from(this.seenIds));
    this.dirty = false;
  }

  dispose(): void {
    this.flushSeen();
    for (const w of this.watchers) {
      try { w.close(); } catch {}
    }
    this.watchers = [];
  }
}
