import type { ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';
import { UNAVAILABLE } from './format';

export interface ChartColumn {
  key: string;
  header: string;
  format?: (v: unknown) => string;
}

/**
 * A chart with its accessible alternative. The "Data table" lists the very rows the chart is drawn from,
 * so what a screen reader (or a test) sees is what the chart shows. A null cell is "Unavailable", never 0.
 */
export function ChartFrame({ label, height = 240, columns, rows, children }: { label: string; height?: number; columns: ChartColumn[]; rows: Record<string, unknown>[]; children: ReactElement }) {
  const cell = (c: ChartColumn, v: unknown) => (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v)) ? UNAVAILABLE : c.format ? c.format(v) : String(v));
  return (
    <div>
      <div role="img" aria-label={label} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="hit cursor-pointer text-accent">Data table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b">
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-1 font-medium text-secondary">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="tnum px-2 py-1">
                      {cell(c, r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
