export type DrawingTool =
  | 'crosshair'
  | 'measure'
  | 'trendline'
  | 'hline'
  | 'rect'
  | 'fib'
  | 'long_pos'
  | 'short_pos';

export type AnalysisMode = 'both' | 'auto' | 'manual';

export interface ChartPoint {
  timestamp: number;
  price: number;
}

export interface ChartDrawing {
  id: string;
  tool: Exclude<DrawingTool, 'crosshair'>;
  color: string;
  p1: ChartPoint;
  p2: ChartPoint;
  /** Optional 3rd anchor price used by Long/Short Position tools for Stop Loss */
  slPrice?: number;
  createdAt: number;
}

export const DRAWING_COLORS = [
  { id: 'sky', value: '#38BDF8', label: 'Sky' },
  { id: 'emerald', value: '#10B981', label: 'Emerald' },
  { id: 'rose', value: '#F43F5E', label: 'Rose' },
  { id: 'amber', value: '#F59E0B', label: 'Amber' },
  { id: 'violet', value: '#A855F7', label: 'Violet' },
] as const;

const STORAGE_KEY = 'altpulse_chart_drawings_v1';

export function loadDrawingsMap(): Record<string, ChartDrawing[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChartDrawing[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDrawingsMap(map: Record<string, ChartDrawing[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}
