import { useCallback, useEffect, useState } from 'react';
import type { Customer, CustomerSummary, CustomerType } from '@crafcube/types';
import { CUSTOMER_TYPE_LABELS } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  Badge, EmptyRow, ErrorNote, Field, Modal, Money,
  PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

export function Customers() {
  const { activeOrg, can } = useSession();
  const currency = activeOrg?.currency ?? '';
  const editable = can('sales.write');

  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('customer_summary')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .order('lifetime_value', { ascending: false });
    if (err) setError(err.message);
    else setRows((data ?? []) as CustomerSummary[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Lifetime value counts what was ordered; outstanding counts what is still owed."
        actions={editable && (
          <button onClick={() => setCreating(true)} className="btn-primary">New customer</button>
        )}
      />

      <ErrorNote message={error} />

      <Panel>
        <Table
          head={
            <>
              <Th>Customer</Th>
              <Th>Type</Th>
              <Th right>Orders</Th>
              <Th right>Lifetime value</Th>
              <Th right>Outstanding</Th>
              <Th right>Last order</Th>
            </>
          }
        >
          {loading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
          {!loading && rows.length === 0 && (
            <EmptyRow colSpan={6}>No customers yet.</EmptyRow>
          )}
          {rows.map((c) => {
            const owed = Number(c.outstanding);
            return (
              <Row key={c.customer_id}>
                <Td className="font-medium text-slate-200">{c.name}</Td>
                <Td><Badge>{CUSTOMER_TYPE_LABELS[c.type]}</Badge></Td>
                <Td right>{c.order_count}</Td>
                <Td right><Money value={c.lifetime_value} currency={currency} /></Td>
                <Td right>
                  {owed > 0.01 ? (
                    <span className="text-amber-300">
                      <Money value={owed} currency={currency} />
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </Td>
                <Td right className="whitespace-nowrap text-slate-500">
                  {c.last_order_at ? new Date(c.last_order_at).toLocaleDateString() : '—'}
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {creating && (
        <CustomerModal onClose={() => setCreating(false)}
                       onSaved={() => { setCreating(false); void load(); }} />
      )}
    </div>
  );
}

function CustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomerType>('retail');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('customers').insert({
      organization_id: activeOrg.id,
      name: name.trim(),
      type,
      phone: phone.trim() || null,
      // Most customers here reach you on the same number they call from.
      whatsapp: (whatsapp.trim() || phone.trim()) || null,
      email: email.trim() || null,
      address: address.trim() || null,
    } satisfies Partial<Customer> & { organization_id: string });

    if (err) setError(err.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <Modal title="New customer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Name">
          <input required className="field" value={name} autoFocus
                 onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Type" hint="Wholesale customers can be priced from their own cost profile.">
          <select className="field" value={type}
                  onChange={(e) => setType(e.target.value as CustomerType)}>
            {(Object.keys(CUSTOMER_TYPE_LABELS) as CustomerType[]).map((t) => (
              <option key={t} value={t}>{CUSTOMER_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone">
            <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="WhatsApp" hint="Defaults to the phone number.">
            <input className="field" value={whatsapp}
                   onChange={(e) => setWhatsapp(e.target.value)} />
          </Field>
        </div>
        <Field label="Email">
          <input type="email" className="field" value={email}
                 onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Address">
          <textarea className="field h-16 resize-none" value={address}
                    onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Create customer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
