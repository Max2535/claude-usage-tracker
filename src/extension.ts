import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { UsageTracker } from './usageTracker';
import { StatusBarManager } from './statusBar';
import { DashboardPanel } from './dashboard/DashboardPanel';
import { LogParser } from './logParser';

export function activate(context: vscode.ExtensionContext): void {
  const tracker    = new UsageTracker(context);
  const statusBar  = new StatusBarManager(tracker);
  const logParser  = new LogParser(tracker, context);

  try {
    statusBar.start();
    logParser.start();
  } catch (err) {
    vscode.window.showErrorMessage(`Claude Usage: startup failed — ${String(err)}`);
    console.error('[ClaudeUsageTracker] startup error:', err);
  }

  // ── Commands ──────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeUsageTracker.showDashboard', () => {
      DashboardPanel.show(context.extensionUri, tracker);

      // Set HTML after panel is created (needs extensionUri for template path)
      if (DashboardPanel.currentPanel) {
        const htmlPath = path.join(
          context.extensionUri.fsPath, 'src', 'dashboard', 'dashboard.html'
        );

        if (fs.existsSync(htmlPath)) {
          DashboardPanel.currentPanel.setHtml(context.extensionUri);
        } else {
          // Fallback for compiled/packaged extension (html in out/)
          vscode.window.showWarningMessage(
            'Claude Usage: dashboard.html not found. Run "npm run compile" first.'
          );
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'claudeUsageTracker.recordUsage',
      async (payload?: { model: string; inputTokens: number; outputTokens: number; timestamp?: string }) => {
        if (!payload) {
          // Interactive fallback
          const model = await vscode.window.showInputBox({ prompt: 'Model name', value: 'claude-sonnet-4' });
          if (!model) return;
          const inputStr = await vscode.window.showInputBox({ prompt: 'Input tokens' });
          const outputStr = await vscode.window.showInputBox({ prompt: 'Output tokens' });
          if (!inputStr || !outputStr) return;

          tracker.record(model, parseInt(inputStr), parseInt(outputStr), 'manual');
        } else {
          tracker.record(
            payload.model,
            payload.inputTokens,
            payload.outputTokens,
            'api-intercept',
            payload.timestamp
          );
        }

        statusBar.refresh();
        DashboardPanel.currentPanel?.update();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeUsageTracker.rescan', () => {
      const r = logParser.rescanNow();
      statusBar.refresh();
      DashboardPanel.currentPanel?.update();
      if (!r.dirExists) {
        vscode.window.showErrorMessage(`Claude Usage: log dir not found — ${r.logDir}`);
      } else {
        vscode.window.showInformationMessage(
          `Claude Usage: scanned ${r.files} files, ingested ${r.newRecords} new records.`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeUsageTracker.clearHistory', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all Claude usage history?',
        { modal: true },
        'Yes, Clear'
      );
      if (confirm === 'Yes, Clear') {
        tracker.clearAll();
        statusBar.refresh();
        DashboardPanel.currentPanel?.update();
        vscode.window.showInformationMessage('Claude usage history cleared.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeUsageTracker.exportCSV', async () => {
      const csv = tracker.exportCSV();
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('claude-usage.csv'),
        filters: { 'CSV': ['csv'] },
      });
      if (uri) {
        const { writeFileSync } = await import('fs');
        writeFileSync(uri.fsPath, csv, 'utf-8');
        vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
      }
    })
  );

  // ── Cleanup ───────────────────────────────────────────────────

  context.subscriptions.push({
    dispose: () => {
      statusBar.dispose();
      logParser.dispose();
    }
  });

  console.log('[ClaudeUsageTracker] Extension activated.');
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions
}
