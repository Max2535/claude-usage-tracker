import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { calculateCostUSD } from './costCalculator';

export interface UsageRecord {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  timestamp: string; // ISO 8601
  source: 'manual' | 'log-parser' | 'api-intercept';
}

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  records: UsageRecord[];
  totalInput: number;
  totalOutput: number;
  totalCostUSD: number;
}

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

export class UsageTracker {
  private context: vscode.ExtensionContext;
  private readonly STORAGE_PREFIX = 'claudeUsage_';

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  record(
    model: string,
    inputTokens: number,
    outputTokens: number,
    source: UsageRecord['source'] = 'manual',
    timestamp?: string
  ): UsageRecord {
    const ts = timestamp ?? new Date().toISOString();
    const date = ts.split('T')[0];

    const record: UsageRecord = {
      id: uuidv4(),
      model,
      inputTokens,
      outputTokens,
      costUSD: calculateCostUSD(model, inputTokens, outputTokens),
      timestamp: ts,
      source,
    };

    const daily = this.getDay(date);
    daily.records.push(record);
    daily.totalInput += inputTokens;
    daily.totalOutput += outputTokens;
    daily.totalCostUSD += record.costUSD;

    this.context.globalState.update(this.STORAGE_PREFIX + date, daily);
    return record;
  }

  getDay(date: string): DailyUsage {
    return this.context.globalState.get<DailyUsage>(this.STORAGE_PREFIX + date, {
      date,
      records: [],
      totalInput: 0,
      totalOutput: 0,
      totalCostUSD: 0,
    });
  }

  getToday(): DailyUsage {
    return this.getDay(todayKey());
  }

  getLast7Days(): DailyUsage[] {
    const days: DailyUsage[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      days.push(this.getDay(key));
    }
    return days;
  }

  clearAll(): void {
    const keys = this.context.globalState.keys().filter(k => k.startsWith(this.STORAGE_PREFIX));
    for (const key of keys) {
      this.context.globalState.update(key, undefined);
    }
  }

  exportCSV(): string {
    const days = this.getLast7Days();
    const rows = ['id,date,model,input_tokens,output_tokens,cost_usd,source,timestamp'];

    for (const day of days) {
      for (const r of day.records) {
        rows.push(
          [r.id, day.date, r.model, r.inputTokens, r.outputTokens,
           r.costUSD.toFixed(8), r.source, r.timestamp].join(',')
        );
      }
    }

    return rows.join('\n');
  }
}
