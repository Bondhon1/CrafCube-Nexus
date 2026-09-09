import { useCallback, useEffect, useState } from 'react';
import type { ConfidenceLevel, Quote } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

const CONFIDENCE_TONE: Record<ConfidenceLevel, 'mint' | 'amber' | 'red'> = {
  HIGH: 'mint',
  MEDIUM: 'amber',
  LOW: 'amber',
  UNRELIABLE: 'red',
};

const BASIS_LABELS: Record<Quote['basis'], string> = {
  geometry: 'Geometry',
  slicer: 'Slicer',
  gcode: 'G-code',
  manual: 'Manual',
};

export function Quotations() {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';

  const [rows, setRows] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Quote | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('quotes')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (err) setError(err.message);
    else setRows((data ?? []) as Quote[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Every quote is a frozen record of the rates it was priced with; none of them change afterwards."
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Quoted</Th>
              <Th>Label</Th>
              <Th>Basis</Th>
              <Th right>Qty</Th>
              <Th right>True cost</Th>
              <Th right>Total price</Th>
              <Th right>Margin</Th>
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={7}>
              No quotes yet. Price a model from its library entry to create one.
            </EmptyRow>
          )}
          {rows.map((q) => (
            <Row key={q.id}>
              <Td className="whitespace-nowrap text-slate-500">
                <button onClick={() => setOpen(q)} className="text-slate-400 hover:text-mint">
                  {new Date(q.created_at).toLocaleDateString()}
                </button>
              </Td>
              <Td className="text-slate-200">{q.label ?? 'Untitled quote'}</Td>
              <Td>
                <Badge tone={CONFIDENCE_TONE[q.confidence]}>
                  {BASIS_LABELS[q.basis]} · {q.confidence}
                </Badge>
              </Td>
              <Td right className="text-slate-300">{q.quantity}</Td>
              <Td right className="text-slate-500">
                <Money value={q.true_cost} currency={currency} />
              </Td>
              <Td right><Money value={q.total_price} currency={currency} /></Td>
              <Td right>
                <span className={Number(q.margin_percent) < 0 ? 'text-red-400' : 'text-mint'}>
                  {Number(q.margin_percent).toFixed(1)}%
                </span>
              </Td>
            </Row>
          ))}
        </Table>
      </Panel>

      {open && <QuoteModal quote={open} currency={currency} onClose={() => setOpen(null)} />}
    </div>
  );
}

function QuoteModal({
  quote, currency, onClose,
}: {
  quote: Quote;
  currency: string;
  onClose: () => void;
}) {
  const lines: [string, number][] = [
    ['Material', quote.material_cost],
    ['Electricity', quote.electricity_cost],
    ['Machine', quote.machine_cost],
    ['Labour', quote.labor_cost],
    ['Consumables', quote.consumables_cost],
    ['Packaging', quote.packaging_cost],
    ['Delivery', quote.delivery_cost],
    ['Failure reserve', quote.failure_reserve],
  ];

  return (
    <Modal title={quote.label ?? 'Quote'} onClose={onClose} width="w-[520px]">
      <div className="space-y-4 text-sm">
        <p className="text-xs text-slate-500">
          Priced on {new Date(quote.created_at).toLocaleString()} from{' '}
          {BASIS_LABELS[quote.basis].toLowerCase()} analysis.
          {quote.confidence_reason && ` ${quote.confidence_reason}`}
        </p>

        <div className="rounded-lg border border-line">
          {lines.map(([label, value]) => (
            <div key={label}
                 className="flex justify-between border-b border-line/60 px-3 py-2 last:border-0">
              <span className="text-slate-400">{label}</span>
              <span className="tabular text-slate-300">
                <Money value={value} currency={currency} />
              </span>
            </div>
          ))}
          <div className="flex justify-between border-t border-line px-3 py-2 font-medium">
            <span className="text-slate-200">True cost (per unit)</span>
            <span className="tabular text-slate-100">
              <Money value={quote.true_cost} currency={currency} />
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Figure label="Minimum" value={quote.minimum_price} currency={currency} />
          <Figure label="Recommended" value={quote.recommended_price} currency={currency} />
          <Figure label={`Total × ${quote.quantity}`} value={quote.total_price}
                  currency={currency} accent />
        </div>

        <p className="text-xs text-slate-500">
          {Number(quote.filament_grams).toFixed(1)} g of filament, priced at{' '}
          {currency} {Number(quote.cost_per_gram).toFixed(4)}/g.
        </p>

        <div className="modal-actions">
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function Figure({
  label, value, currency, accent = false,
}: {
  label: string;
  value: number;
  currency: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`tabular mt-1 text-sm font-semibold ${accent ? 'text-mint' : 'text-slate-200'}`}>
        <Money value={value} currency={currency} />
      </p>
    </div>
  );
}
