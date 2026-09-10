/**
 * Visual test harness for the chart kit and the user guide.
 *
 * The real screens need a signed-in session, so this is the only way to look at
 * a chart before shipping it — which the charts needed: it caught y-axis labels
 * overflowing their gutter and an axis topping out at nearly double the data.
 *
 *   pnpm --filter desktop preview:charts
 *   then open apps/desktop/dist-preview/preview.html (add ?view=guide for the guide)
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@/styles/index.css';
import {
  ACCENT, BarChart, LineChart, RankedBars, SERIES, StackedBarChart, Sparkline,
} from '@/components/charts';
import { UserGuide } from '@/components/UserGuide';

const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const rev = [4200, 5100, 3800, 6400, 7100, 5900, 8200, 9400, 8800, 11200, 10400, 12600];
const profit = [900, 1400, -600, 1800, 2300, 1500, 2900, 3600, 3100, 4400, 3900, 5200];
const money = (v: number) => `Tk ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const kilos = (v: number) => `${(v / 1000).toFixed(1)} kg`;

function App() {
  return (
    <div className="min-h-screen bg-ink-900 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <LineChart title="Revenue and net profit" subtitle="Two series, one axis."
            format={money}
            series={[
              { name: 'Revenue', points: MONTHS.map((m, i) => ({ label: m, value: rev[i] })) },
              { name: 'Net profit', points: MONTHS.map((m, i) => ({ label: m, value: profit[i] })) },
            ]} />
          <StackedBarChart title="Where filament goes" subtitle="Part to whole, four bands."
            names={['Into product', 'Wasted', 'Samples', 'Drying loss']} format={kilos}
            points={MONTHS.map((m, i) => ({
              label: m, parts: [3000 + i * 300, 400 + (i % 4) * 90, 120, 60],
            }))} />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <BarChart title="Jobs finished each month" subtitle="One hue; tallest column labelled."
              format={(v) => v.toFixed(0)}
              points={MONTHS.map((m, i) => ({ label: m, value: 4 + ((i * 5) % 17) }))} />
          </div>
          <RankedBars title="Machine hours" subtitle="Ranked comparison."
            format={(v) => `${(v / 3600).toFixed(0)}h`}
            points={[
              { label: 'Kobra X', value: 512000 },
              { label: 'Kobra 2 Max with a very long name', value: 288000 },
              { label: 'Bambu P1S', value: 96000 },
            ]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Revenue</p>
              <p className="mt-2 text-xl font-semibold text-slate-100">{money(rev[11 - i])}</p>
              <div className="mt-3 opacity-60">
                <Sparkline values={rev} color={i === 0 ? ACCENT : SERIES[i]} />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <LineChart title="Single series" subtitle="No legend: the title names it."
            format={money}
            series={[{ name: 'Profit / hour', points: MONTHS.map((m, i) => ({ label: m, value: profit[i] / 8 })) }]} />
          <BarChart title="Empty state" subtitle="Nothing recorded." format={money}
            points={MONTHS.map((m) => ({ label: m, value: null }))} />
        </div>
      </div>
    </div>
  );
}

const mode = new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(
  mode === 'guide'
    ? <MemoryRouter><div className="min-h-screen bg-ink-900"><UserGuide onClose={() => {}} /></div></MemoryRouter>
    : <App />,
);
