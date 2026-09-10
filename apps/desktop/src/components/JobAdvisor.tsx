import { useEffect, useMemo, useState } from 'react';
import type { ModelReliability, PrinterAnalytics } from '@crafcube/types';
import { batchStrategies, estimateRisk, formatDuration } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { Badge } from '@/components/ui';

const BAND_TONE = {
  low: 'mint',
  medium: 'amber',
  high: 'red',
  unknown: 'slate',
} as const;

const BAND_LABEL = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  unknown: 'Not enough history',
} as const;

/**
 * §20 and §34, side by side on the job that is about to be created.
 *
 * Both are advisory. §34 says risk must never block the operator, and §85
 * rules out the ML that section imagines — so this is a stated heuristic over
 * history the shop already has, with every contribution spelled out.
 */
export function JobAdvisor({
  modelId,
  printerId,
  quantity,
  unitSeconds,
  unitGrams,
  maxPerPlate,
}: {
  modelId: string | null;
  printerId: string | null;
  quantity: number;
  unitSeconds: number;
  unitGrams: number;
  maxPerPlate?: number;
}) {
  const { activeOrg } = useSession();
  const [model, setModel] = useState<ModelReliability | null>(null);
  const [printer, setPrinter] = useState<PrinterAnalytics | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;

    void (async () => {
      const [m, p] = await Promise.all([
        modelId
          ? supabase.from('model_reliability').select('*').eq('model_id', modelId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        printerId
          ? supabase.from('printer_analytics').select('*')
              .eq('printer_id', printerId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      setModel((m.data ?? null) as ModelReliability | null);
      setPrinter((p.data ?? null) as PrinterAnalytics | null);
    })();

    return () => { cancelled = true; };
  }, [activeOrg, modelId, printerId]);

  const risk = useMemo(() => estimateRisk({
    modelFailureRate: model === null ? null : Number(model.failure_rate),
    modelSamples: Number(model?.finished_jobs ?? 0),
    printerFailureRate: printer?.success_rate == null
      ? null : 100 - Number(printer.success_rate),
    printerSamples: Number(printer?.finished_jobs ?? 0),
    printSeconds: unitSeconds,
  }), [model, printer, unitSeconds]);

  const strategies = useMemo(
    () => batchStrategies(quantity, unitSeconds, unitGrams, { maxPerPlate }),
    [quantity, unitSeconds, unitGrams, maxPerPlate],
  );

  const oneAtATime = strategies.find((s) => s.perPlate === 1);
  const fullest = strategies[strategies.length - 1];
  const saving = oneAtATime && fullest && fullest !== oneAtATime
    ? oneAtATime.totalSeconds - fullest.totalSeconds
    : 0;

  if (unitSeconds <= 0) return null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-ink-950/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
            Print risk
          </p>
          <Badge tone={BAND_TONE[risk.band]}>
            {BAND_LABEL[risk.band]}
            {risk.percent !== null && ` · ${risk.percent.toFixed(1)}%`}
          </Badge>
        </div>
        <ul className="mt-2 space-y-0.5">
          {risk.reasons.map((reason) => (
            <li key={reason} className="text-xs text-slate-500">• {reason}</li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-600">
          Advisory only — nothing here stops you printing.
        </p>
      </div>

      {strategies.length > 1 && (
        <div className="rounded-lg border border-line bg-ink-950/50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
              Batching {quantity}
            </p>
            {saving > 0 && (
              <span className="text-xs text-mint">
                up to {formatDuration(saving)} faster
              </span>
            )}
          </div>

          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-600">
                <th className="pb-1 font-medium">Plate</th>
                <th className="pb-1 text-right font-medium">Plates</th>
                <th className="pb-1 text-right font-medium">Total time</th>
                <th className="pb-1 text-right font-medium">Material</th>
                <th className="pb-1 text-right font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <tr key={s.perPlate} className="border-t border-line/50">
                  <td className="py-1 text-slate-300">
                    {s.perPlate} ×
                    {s.produced > quantity && (
                      <span className="ml-1 text-slate-600">
                        (makes {s.produced})
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right text-slate-400">{s.plates}</td>
                  <td className="tabular py-1 text-right text-slate-300">
                    {formatDuration(s.totalSeconds)}
                  </td>
                  <td className="tabular py-1 text-right text-slate-400">
                    {s.totalGrams.toFixed(0)} g
                  </td>
                  <td className="py-1 text-right text-slate-500">{s.risk}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 text-[11px] text-slate-600">
            Fuller plates pay the setup cost once, so they finish sooner for the same material —
            but a failure takes the whole plate with it.
          </p>
        </div>
      )}
    </div>
  );
}
