import { useCallback, useEffect, useState } from 'react';
import type { FilamentTransaction, InventoryTxnType } from '@crafcube/types';
import { INVENTORY_TXN_TYPES, TXN_LABELS } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Grams, Money, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

interface TxnRow extends FilamentTransaction {
  spool: { id: string; code: string } | null;
}

const PAGE_SIZE = 100;

export function Transactions() {
  const { activeOrg } = useSession();
  const currency = activeOrg?.currency ?? '';

  const [rows, setRows] = useState<TxnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InventoryTxnType | 'all'>('all');

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    let query = supabase
      .from('filament_transactions')
      .select('*, spool:filament_spools(id, code)')
      .eq('organization_id', activeOrg.id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (filter !== 'all') query = query.eq('type', filter);

    const { data, error: err } = await query;
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as TxnRow[]);
    setLoading(false);
  }, [activeOrg, filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="The filament ledger. Entries are append-only — corrections are recorded as adjustments."
        actions={
          <select
            className="field w-40 sm:w-56"
            value={filter}
            onChange={(e) => setFilter(e.target.value as InventoryTxnType | 'all')}
          >
            <option value="all">All types</option>
            {INVENTORY_TXN_TYPES.map((t) => (
              <option key={t} value={t}>{TXN_LABELS[t]}</option>
            ))}
          </select>
        }
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>When</Th>
              <Th>Spool</Th>
              <Th>Type</Th>
              <Th right>Change</Th>
              <Th right>Cost/g</Th>
              <Th right>Value</Th>
              <Th>Reason</Th>
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={7}>No movements recorded yet.</EmptyRow>
          )}
          {rows.map((t) => {
            const grams = Number(t.grams);
            const reserving = t.type === 'RESERVATION' || t.type === 'RESERVATION_RELEASE';
            return (
              <Row key={t.id}>
                <Td>
                  <span className="whitespace-nowrap font-mono text-xs text-slate-500">
                    {new Date(t.created_at).toLocaleString()}
                  </span>
                </Td>
                <Td><span className="font-mono text-xs text-slate-300">{t.spool?.code ?? '—'}</span></Td>
                <Td>
                  <Badge tone={reserving ? 'slate' : grams > 0 ? 'mint' : 'amber'}>
                    {TXN_LABELS[t.type]}
                  </Badge>
                </Td>
                <Td right className={grams > 0 ? 'text-mint' : 'text-slate-300'}>
                  {grams > 0 ? '+' : '−'}
                  <Grams value={Math.abs(grams)} />
                </Td>
                <Td right className="text-slate-500">
                  {t.cost_per_gram != null ? Number(t.cost_per_gram).toFixed(3) : '—'}
                </Td>
                <Td right>
                  {t.value != null ? <Money value={Math.abs(Number(t.value))} currency={currency} /> : '—'}
                </Td>
                <Td className="text-slate-500">{t.reason ?? '—'}</Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {rows.length === PAGE_SIZE && (
        <p className="mt-3 text-xs text-slate-600">
          Showing the most recent {PAGE_SIZE} movements.
        </p>
      )}
    </div>
  );
}
