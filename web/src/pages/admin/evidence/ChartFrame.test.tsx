import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Bar, BarChart } from 'recharts';
import { renderWithApp } from '../../../test/render';
import { ChartFrame } from './ChartFrame';

const columns = [
  { key: 'week', header: 'Week' },
  { key: 'count', header: 'Overdue (count)' },
];
const rows = [
  { week: 'W1', count: 3 },
  { week: 'W2', count: 0 },
  { week: 'W3', count: null },
];

function chart() {
  return (
    <BarChart data={rows}>
      <Bar dataKey="count" />
    </BarChart>
  );
}

describe('ChartFrame', () => {
  it('exposes the chart as an image with its label', () => {
    renderWithApp(
      <ChartFrame label="Overdue cases per week" columns={columns} rows={rows}>
        {chart()}
      </ChartFrame>,
    );
    expect(screen.getByRole('img', { name: 'Overdue cases per week' })).toBeInTheDocument();
  });
  it('data table has exactly rows.length body rows and the right headers', () => {
    const { container } = renderWithApp(
      <ChartFrame label="x" columns={columns} rows={rows}>
        {chart()}
      </ChartFrame>,
    );
    const details = container.querySelector('details')!;
    expect(details).toHaveTextContent('Data table');
    const table = within(details).getByRole('table', { hidden: true });
    expect(within(table).getAllByRole('columnheader', { hidden: true }).map((h) => h.textContent)).toEqual(['Week', 'Overdue (count)']);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
  });
  it('null reads Unavailable, zero reads 0, formatters apply', () => {
    const { container } = renderWithApp(
      <ChartFrame label="x" columns={[columns[0]!, { ...columns[1]!, format: (v) => `${v} cases` }]} rows={rows}>
        {chart()}
      </ChartFrame>,
    );
    const cells = Array.from(container.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
    expect(cells).toEqual([
      ['W1', '3 cases'],
      ['W2', '0 cases'],
      ['W3', 'Unavailable'],
    ]);
  });
});
