import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { UsageTracker, UsageRecord } from '../usageTracker';
import { formatCost } from '../costCalculator';

interface EnrichedRecord extends UsageRecord {
  costFormatted: string;
}

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private tracker: UsageTracker;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, tracker: UsageTracker) {
    this.panel = panel;
    this.tracker = tracker;

    this.panel.webview.onDidReceiveMessage(
      msg => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.update();
  }

  static show(extensionUri: vscode.Uri, tracker: UsageTracker): void {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal();
      DashboardPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'claudeUsageDashboard',
      'Claude Usage',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, tracker);
  }

  private handleMessage(msg: { command: string }): void {
    switch (msg.command) {
      case 'refresh':
        this.update();
        break;
      case 'exportCSV':
        this.exportCSV();
        break;
      case 'clearHistory':
        this.tracker.clearAll();
        this.update();
        vscode.window.showInformationMessage('Claude usage history cleared.');
        break;
    }
  }

  update(): void {
    const config = vscode.workspace.getConfiguration('claudeUsageTracker');
    const currency = config.get<'USD' | 'THB'>('currency', 'USD');
    const thbRate = config.get<number>('thbRate', 33);

    const today = this.tracker.getToday();
    const week  = this.tracker.getLast7Days();

    const enrichRecord = (r: UsageRecord): EnrichedRecord => ({
      ...r,
      costFormatted: formatCost(r.costUSD, currency, thbRate),
    });

    const data = {
      currency,
      today: {
        ...today,
        totalCostFormatted: formatCost(today.totalCostUSD, currency, thbRate),
        records: today.records.map(enrichRecord),
      },
      week: week.map(d => ({
        ...d,
        totalCostFormatted: formatCost(d.totalCostUSD, currency, thbRate),
        records: d.records.map(enrichRecord),
      })),
    };

    this.panel.webview.postMessage({ command: 'update', data });
  }

  private async exportCSV(): Promise<void> {
    const csv = this.tracker.exportCSV();
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('claude-usage.csv'),
      filters: { 'CSV': ['csv'] },
    });
    if (uri) {
      fs.writeFileSync(uri.fsPath, csv, 'utf-8');
      vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
  }

  getHtml(htmlTemplatePath: string): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    let html = fs.readFileSync(htmlTemplatePath, 'utf-8');
    html = html.replace(/\{\{NONCE\}\}/g, nonce);
    return html;
  }

  setHtml(extensionUri: vscode.Uri): void {
    const htmlPath = path.join(extensionUri.fsPath, 'src', 'dashboard', 'dashboard.html');
    this.panel.webview.html = this.getHtml(htmlPath);
  }

  dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
