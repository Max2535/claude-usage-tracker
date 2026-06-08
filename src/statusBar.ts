import * as vscode from 'vscode';
import { UsageTracker } from './usageTracker';
import { formatTokens, formatCost } from './costCalculator';

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private tracker: UsageTracker;
  private timer: NodeJS.Timeout | undefined;

  constructor(tracker: UsageTracker) {
    this.tracker = tracker;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'claudeUsageTracker.showDashboard';
    this.item.tooltip = 'Click to open Claude Usage Dashboard';
  }

  start(): void {
    const config = vscode.workspace.getConfiguration('claudeUsageTracker');
    if (!config.get<boolean>('showStatusBar', true)) {
      this.item.hide();
      return;
    }

    this.refresh();
    this.item.show();

    // Refresh every 30 seconds
    this.timer = setInterval(() => this.refresh(), 30_000);
  }

  refresh(): void {
    const today = this.tracker.getToday();
    const config = vscode.workspace.getConfiguration('claudeUsageTracker');
    const currency = config.get<'USD' | 'THB'>('currency', 'USD');
    const thbRate = config.get<number>('thbRate', 33);

    const totalTokens = today.totalInput + today.totalOutput;
    const cost = formatCost(today.totalCostUSD, currency, thbRate);

    this.item.text = `$(pulse) Claude: ${formatTokens(totalTokens)} (${cost})`;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
