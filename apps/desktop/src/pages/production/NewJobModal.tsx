import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FilamentSpool, Model, ModelFile, ModelVersion, Printer,
} from '@crafcube/types';
import { formatDuration } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { objectStore } from '@/lib/storage';
import { Badge, ErrorNote, Field, Grams, Modal } from '@/components/ui';

interface VersionWithFiles extends ModelVersion {
  files: ModelFile[];
}

interface ModelWithVersions extends Model {
  versions: VersionWithFiles[];
}

type SpoolOption = FilamentSpool & { product: { name: string; color_hex: string | null } | null };

/** One material lane: a tool index, its grams and the spool feeding it. */
interface MaterialLane {
  toolIndex: number;
  grams: number;
  spoolId: string;
}

type EstimateBasis = 'none' | 'slicer' | 'geometry';

interface Estimate {
  basis: EstimateBasis;
  grams: number;
  seconds: number;
  lanes: MaterialLane[];
  confidence: string;
  detail: string;
}

/**
 * Filament length to mass. The slicer reports per-tool extrusion in millimetres
 * of filament, so a multi-colour split has to be converted before it can be
 * reserved from a spool.
 */
function lengthToGrams(mm: number, diameterMm: number, density: number): number {
  const radiusCm = diameterMm / 2 / 10;
  const volumeCm3 = Math.PI * radiusCm * radiusCm * (mm / 10);
  return volumeCm3 * density;
}

export function NewJobModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();

  const [models, setModels] = useState<ModelWithVersions[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [spools, setSpools] = useState<SpoolOption[]>([]);

  const [modelId, setModelId] = useState('');
  const [printerId, setPrinterId] = useState('');
  const [quantity, setQuantity] = useState('1');

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg) return;
    void (async () => {
      const [m, p, s] = await Promise.all([
        supabase.from('models')
          .select('*, versions:model_versions(*, files:model_files(*))')
          .eq('organization_id', activeOrg.id).eq('archived', false).order('name'),
        supabase.from('printers').select('*').eq('organization_id', activeOrg.id)
          .neq('status', 'retired').order('name'),
        supabase.from('filament_spools')
          .select('*, product:filament_products(name, color_hex)')
          .eq('organization_id', activeOrg.id).in('status', ['sealed', 'in_use']).order('code'),
      ]);
      setModels((m.data ?? []) as unknown as ModelWithVersions[]);
      setPrinters((p.data ?? []) as Printer[]);
      setSpools((s.data ?? []) as unknown as SpoolOption[]);
      setPrinterId((c) => c || (p.data?.[0] as Printer | undefined)?.id || '');
    })();
  }, [activeOrg]);

  const model = models.find((m) => m.id === modelId);
  const version = useMemo(
    () => (model ? [...model.versions].sort((a, b) => b.version - a.version)[0] : undefined),
    [model],
  );
  const printer = printers.find((p) => p.id === printerId);

  /** Falls back to stored geometry, which every analysed version already has. */
  const geometryEstimate = useCallback((): Estimate | null => {
    if (!version?.volume_cm3) return null;
    // Shell plus 15% infill, the same split the engine uses for level A.
    const grams = Number(version.volume_cm3) * 1.24 * 0.35;
    return {
      basis: 'geometry',
      grams: Math.round(grams * 10) / 10,
      seconds: 0,
      lanes: [{ toolIndex: 0, grams: Math.round(grams * 10) / 10, spoolId: spools[0]?.id ?? '' }],
      confidence: 'LOW',
      detail: 'From stored geometry. Slice for a costing-grade figure.',
    };
  }, [version, spools]);

  useEffect(() => {
    setEstimate(model ? geometryEstimate() : null);
  }, [model, geometryEstimate]);

  /**
   * Downloads the model and slices it with the real printer profile — §41's
   * primary costing source, rather than asking an operator to guess.
   */
  async function runSlice() {
    const bridge = window.nexus?.engine;
    const source = version?.files.find((f) => f.kind === 'source' || f.kind === 'mesh');
    if (!bridge || !source || !version) return;

    setError(null);
    setEstimating('Fetching the model…');
    try {
      const blob = await objectStore.download(source.storage_key);

      setEstimating('Slicing…');
      const response = await bridge.slice(source.filename, await blob.arrayBuffer(), {
        printer: (printer?.model || printer?.name || 'Kobra X').replace(/^Anycubic\s+/i, ''),
        vendor: printer?.brand || 'Anycubic',
        layer_height_mm: 0.2,
        infill_percent: 15,
        nozzle_mm: 0.4,
      });

      if (response.status !== 'success' || !response.slice.gcode) {
        setError(response.slice.error ?? 'The slicer produced no result.');
        return;
      }

      const g = response.slice.gcode;
      const grams = g.slicer_filament_grams ?? g.calculated_filament_grams ?? 0;
      const density = g.density_g_cm3 ?? 1.24;

      // Per-tool extrusion becomes one lane per colour the slicer actually used.
      const perTool = Object.entries(g.per_tool_filament_mm ?? {});
      const lanes: MaterialLane[] = perTool.length > 1
        ? perTool.map(([tool, mm], i) => ({
            toolIndex: Number(tool),
            grams: Math.round(lengthToGrams(mm, g.filament_diameter_mm, density) * 10) / 10,
            spoolId: spools[i]?.id ?? spools[0]?.id ?? '',
          }))
        : [{ toolIndex: 0, grams, spoolId: spools[0]?.id ?? '' }];

      setEstimate({
        basis: 'slicer',
        grams,
        seconds: g.slicer_print_time_seconds ?? 0,
        lanes,
        confidence: response.confidence?.level ?? 'MEDIUM',
        detail: response.confidence?.reason ?? (response.slice.slicer_name ?? 'Sliced'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEstimating(null);
    }
  }

  const qty = Math.max(Number(quantity) || 1, 1);

  function setLaneSpool(toolIndex: number, spoolId: string) {
    if (!estimate) return;
    setEstimate({
      ...estimate,
      lanes: estimate.lanes.map((l) => (l.toolIndex === toolIndex ? { ...l, spoolId } : l)),
    });
  }

  const shortfalls = (estimate?.lanes ?? []).flatMap((lane) => {
    const spool = spools.find((s) => s.id === lane.spoolId);
    if (!spool) return [];
    const needed = lane.grams * qty;
    const short = needed - Number(spool.remaining_grams);
    return short > 0 ? [{ code: spool.code, short }] : [];
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg || !estimate) return;
    setBusy(true);
    setError(null);

    try {
      const { data: code, error: codeErr } = await supabase.rpc('next_job_code', {
        p_org: activeOrg.id,
      });
      if (codeErr) throw new Error(codeErr.message);

      const { data: job, error: jobErr } = await supabase
        .from('print_jobs')
        .insert({
          organization_id: activeOrg.id,
          code,
          model_version_id: version?.id ?? null,
          printer_id: printerId || null,
          quantity: qty,
          estimated_seconds: estimate.seconds * qty,
          notes: model?.name ?? null,
        })
        .select()
        .single();
      if (jobErr) throw new Error(jobErr.message);

      // Materials carry the estimate; a trigger rolls them into the job total.
      const lanes = estimate.lanes.filter((l) => l.spoolId && l.grams > 0);
      if (lanes.length > 0) {
        const { error: matErr } = await supabase.from('print_job_materials').insert(
          lanes.map((l) => ({
            organization_id: activeOrg.id,
            job_id: (job as { id: string }).id,
            spool_id: l.spoolId,
            tool_index: l.toolIndex,
            estimated_grams: l.grams * qty,
          })),
        );
        if (matErr) throw new Error(matErr.message);
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSlice = Boolean(version?.files.some((f) => f.kind === 'source' || f.kind === 'mesh'));

  return (
    <Modal title="New print job" onClose={onClose} width="w-[560px]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <Field label="Model">
          <select className="field" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">Choose a model…</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.versions.length > 0
                  ? ` · v${Math.max(...m.versions.map((v) => v.version))}`
                  : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Printer">
            <select className="field" value={printerId}
                    onChange={(e) => setPrinterId(e.target.value)}>
              <option value="">Unassigned</option>
              {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Quantity">
            <input required type="number" min="1" className="field" value={quantity}
                   onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>

        {model && (
          <div className="rounded-lg border border-line bg-ink-950/50 p-4">
            <div className="flex items-center justify-between">
              <p className="label mb-0">Estimate</p>
              <button
                type="button"
                onClick={() => void runSlice()}
                disabled={!canSlice || estimating !== null}
                className="btn-ghost px-3 py-1.5 text-xs"
                title={canSlice ? undefined : 'This version has no source file to slice'}
              >
                {estimating ?? (estimate?.basis === 'slicer' ? 'Re-slice' : 'Slice for accuracy')}
              </button>
            </div>

            {estimate ? (
              <>
                <div className="mt-3 flex items-baseline gap-6">
                  <div>
                    <p className="tabular text-2xl font-semibold text-slate-100">
                      <Grams value={estimate.grams * qty} />
                    </p>
                    <p className="text-[11px] text-slate-500">material</p>
                  </div>
                  <div>
                    <p className="tabular text-2xl font-semibold text-slate-100">
                      {formatDuration(estimate.seconds * qty)}
                    </p>
                    <p className="text-[11px] text-slate-500">print time</p>
                  </div>
                  <div className="ml-auto text-right">
                    <Badge tone={
                      estimate.confidence === 'HIGH' ? 'mint'
                        : estimate.confidence === 'LOW' ? 'amber' : 'slate'
                    }>
                      {estimate.basis === 'slicer' ? 'Sliced' : 'Geometry'} · {estimate.confidence}
                    </Badge>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">{estimate.detail}</p>

                <div className="mt-4 space-y-2 border-t border-line pt-3">
                  {estimate.lanes.map((lane) => (
                    <div key={lane.toolIndex} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs text-slate-500">
                        {estimate.lanes.length > 1 ? `Colour ${lane.toolIndex + 1}` : 'Filament'}
                      </span>
                      <select
                        className="field flex-1 py-1.5 text-xs"
                        value={lane.spoolId}
                        onChange={(e) => setLaneSpool(lane.toolIndex, e.target.value)}
                      >
                        <option value="">No spool</option>
                        {spools.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} — {s.product?.name ?? ''} ·{' '}
                            {Math.round(Number(s.remaining_grams))} g
                          </option>
                        ))}
                      </select>
                      <span className="tabular w-20 shrink-0 text-right text-xs text-slate-400">
                        {(lane.grams * qty).toFixed(0)} g
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                This version has not been analysed. Slice it to get material and time.
              </p>
            )}
          </div>
        )}

        {shortfalls.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Not enough material:{' '}
            {shortfalls.map((s) => `${s.code} is ${s.short.toFixed(0)} g short`).join(', ')}.
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || !estimate || !model} className="btn-primary">
            {busy ? 'Queuing…' : 'Queue job'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
