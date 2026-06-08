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
    this.item.tooltip = this.buildTooltip(currency, thbRate);
  }

  // Rich hover panel (renders like the Copilot status-bar popup).
  private buildTooltip(currency: 'USD' | 'THB', thbRate: number): vscode.MarkdownString {
    const today = this.tracker.getToday();
    const week = this.tracker.getLast7Days();

    const todayTokens = today.totalInput + today.totalOutput;
    const weekCostUSD = week.reduce((s, d) => s + d.totalCostUSD, 0);
    const weekTokens = week.reduce((s, d) => s + d.totalInput + d.totalOutput, 0);

    // Per-model breakdown for today
    const byModel = new Map<string, { tokens: number; cost: number }>();
    for (const r of today.records) {
      const m = byModel.get(r.model) ?? { tokens: 0, cost: 0 };
      m.tokens += r.inputTokens + r.outputTokens;
      m.cost += r.costUSD;
      byModel.set(r.model, m);
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    md.appendMarkdown(`### $(pulse) Claude Usage\n\n`);
    md.appendMarkdown(`**Today**  &nbsp;·&nbsp;  ${formatTokens(todayTokens)} tokens  &nbsp;·&nbsp;  ${formatCost(today.totalCostUSD, currency, thbRate)}\n\n`);
    md.appendMarkdown(`&nbsp;&nbsp;In ${formatTokens(today.totalInput)} &nbsp; Out ${formatTokens(today.totalOutput)}\n\n`);

    if (byModel.size > 0) {
      md.appendMarkdown(`---\n\n`);
      for (const [model, m] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
        md.appendMarkdown(`$(chip) ${model} &nbsp; ${formatTokens(m.tokens)} &nbsp; ${formatCost(m.cost, currency, thbRate)}\n\n`);
      }
    }

    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`**Last 7 days**  &nbsp;·&nbsp;  ${formatTokens(weekTokens)} tokens  &nbsp;·&nbsp;  ${formatCost(weekCostUSD, currency, thbRate)}\n\n`);

    // Budget projection (only when configured)
    const config = vscode.workspace.getConfiguration('claudeUsageTracker');
    const monthlyBudgetUSD = config.get<number>('monthlyBudgetUSD', 0);
    const tokenBudget = config.get<number>('tokenBudget', 0);

    if (monthlyBudgetUSD > 0 || tokenBudget > 0) {
      const mtd = this.tracker.getMonthToDate();
      // Recent daily burn from last 7 days — more predictive than month average.
      const burnPerDayUSD = weekCostUSD / 7;
      const burnPerDayTokens = weekTokens / 7;

      md.appendMarkdown(`---\n\n`);

      if (monthlyBudgetUSD > 0) {
        const pct = Math.min(100, (mtd.totalCostUSD / monthlyBudgetUSD) * 100);
        const remaining = Math.max(0, monthlyBudgetUSD - mtd.totalCostUSD);
        md.appendMarkdown(`**Budget**  &nbsp;·&nbsp;  ${formatCost(mtd.totalCostUSD, currency, thbRate)} / ${formatCost(monthlyBudgetUSD, currency, thbRate)}/mo  &nbsp;·&nbsp;  ${pct.toFixed(0)}%\n\n`);
        md.appendMarkdown(`${this.progressBar(pct)}\n\n`);
        md.appendMarkdown(`&nbsp;&nbsp;Burn ${formatCost(burnPerDayUSD, currency, thbRate)}/day &nbsp;→&nbsp; ${this.projection(remaining, burnPerDayUSD, monthlyBudgetUSD, mtd.totalCostUSD)}\n\n`);
      }

      if (tokenBudget > 0) {
        const mtdTokens = mtd.totalInput + mtd.totalOutput;
        const pct = Math.min(100, (mtdTokens / tokenBudget) * 100);
        const remaining = Math.max(0, tokenBudget - mtdTokens);
        md.appendMarkdown(`**Token budget**  &nbsp;·&nbsp;  ${formatTokens(mtdTokens)} / ${formatTokens(tokenBudget)}  &nbsp;·&nbsp;  ${pct.toFixed(0)}%\n\n`);
        md.appendMarkdown(`${this.progressBar(pct)}\n\n`);
        md.appendMarkdown(`&nbsp;&nbsp;Burn ${formatTokens(Math.round(burnPerDayTokens))}/day &nbsp;→&nbsp; ${this.projection(remaining, burnPerDayTokens, tokenBudget, mtdTokens)}\n\n`);
      }
    }

    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`[$(graph) Dashboard](command:claudeUsageTracker.showDashboard) &nbsp;&nbsp; [$(sync) Rescan](command:claudeUsageTracker.rescan) &nbsp;&nbsp; [$(export) Export CSV](command:claudeUsageTracker.exportCSV)`);

    return md;
  }

  // 10-segment block bar, e.g. ██████░░░░
  private progressBar(pct: number): string {
    const filled = Math.round(Math.min(100, Math.max(0, pct)) / 10);
    return `\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\``;
  }

  // "full in ~10 days (Jun 19)" / "over budget" / "no recent usage"
  private projection(remaining: number, burnPerDay: number, budget: number, used: number): string {
    if (used >= budget) return `**over budget**`;
    if (burnPerDay <= 0) return `no recent usage`;

    const daysLeft = remaining / burnPerDay;
    const eta = new Date();
    eta.setDate(eta.getDate() + Math.ceil(daysLeft));
    const etaStr = eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    const rounded = daysLeft >= 1 ? Math.round(daysLeft) : Math.ceil(daysLeft);
    return `full in ~${rounded} day${rounded === 1 ? '' : 's'} (${etaStr})`;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
