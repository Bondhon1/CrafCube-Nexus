import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FilamentSpool, Model, ModelFile, ModelVersion, Printer } from '@crafcube/types';
import { formatDuration } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { objectStore } from '@/lib/storage';
import { Badge, ErrorNote, Field, Grams, Modal } from '@/components/ui';
import { JobAdvisor } from '@/components/JobAdvisor';
import { Visualizer, type ColorGroup } from '@/components/Visualizer';

interface VersionWithFiles extends ModelVersion {
  files: ModelFile[];
}
interface ModelWithVersions extends Model {
  versions: VersionWithFiles[];
}
type SpoolOption = FilamentSpool & {
  product: { name: string; color_hex: string | null; color_name: string | null } | null;
};

/** One colour of the job: a tool slot, its share of material, and its spool. */
interface Lane {
  toolIndex: number;
  grams: number;
  spoolId: string;
  /** Colour the file carried, kept so a lane without a spool still looks right. */
  sourceColor: string;
}

interface Estimate {
  basis: 'geometry' | 'slicer';
  grams: number;
  seconds: number;
  confidence: string;
  detail: string;
}

function lengthToGrams(mm: number, diameterMm: number, density: number): number {
  const radiusCm = diameterMm / 2 / 10;
  return Math.PI * radiusCm * radiusCm * (mm / 10) * density;
}

export function NewJobModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeOrg } = useSession();

  const [models, setModels] = useState<ModelWithVersions[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [spools, setSpools] = useState<SpoolOption[]>([]);

  const [modelId, setModelId] = useState('');
  const [printerId, setPrinterId] = useState('');
  const [quantity, setQuantity] = useState('1');

  const [mesh, setMesh] = useState<{ buffer: ArrayBuffer; filename: string } | null>(null);
  const [groups, setGroups] = useState<ColorGroup[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loadingMesh, setLoadingMesh] = useState(false);
  const [slicing, setSlicing] = useState<string | null>(null);
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
          .select('*, product:filament_products(name, color_hex, color_name)')
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
  const source = version?.files.find((f) => f.kind === 'source' || f.kind === 'mesh');

  const bed = {
    x: Number(printer?.build_x_mm ?? 260),
    y: Number(printer?.build_y_mm ?? 260),
    z: Number(printer?.build_z_mm ?? 260),
  };

  // Load the model itself, so colours can be read from the file rather than
  // guessed. 3MF keeps its material groups; STL is a single body.
  useEffect(() => {
    if (!source) { setMesh(null); setGroups([]); return; }
    let cancelled = false;
    setLoadingMesh(true);
    setError(null);

    void (async () => {
      try {
        const blob = await objectStore.download(source.storage_key);
        if (cancelled) return;
        setMesh({ buffer: await blob.arrayBuffer(), filename: source.filename });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoadingMesh(false);
      }
    })();

    return () => { cancelled = true; };
  }, [source]);

  /** Geometry fallback: volume × density × a shell-plus-infill factor. */
  const geometryGrams = version?.volume_cm3 ? Number(version.volume_cm3) * 1.24 * 0.35 : 0;

  // Colour groups from the file become lanes, split by triangle share until a
  // slice provides the real per-tool figures.
  const handleGroups = useCallback((detected: ColorGroup[]) => {
    setGroups(detected);
    setLanes((current) => {
      if (current.length === detected.length) return current;
      return detected.map((g, i) => ({
        toolIndex: i,
        grams: Math.round(geometryGrams * g.share * 10) / 10,
        spoolId: '',
        sourceColor: g.sourceColor,
      }));
    });
    if (!estimate && geometryGrams > 0) {
      setEstimate({
        basis: 'geometry',
        grams: Math.round(geometryGrams * 10) / 10,
        seconds: 0,
        confidence: 'LOW',
        detail: detected.length > 1
          ? `${detected.length} colours found in the file. Slice for real per-colour weights.`
          : 'From stored geometry. Slice for a costing-grade figure.',
      });
    }
  }, [geometryGrams, estimate]);

  async function runSlice() {
    const bridge = window.nexus?.engine;
    if (!bridge || !mesh || !source) return;
    setError(null);
    setSlicing('Slicing…');
    try {
      const response = await bridge.slice(source.filename, mesh.buffer, {
        printer: (printer?.model || printer?.name || 'Kobra X').replace(/^Anycubic\s+/i, ''),
        vendor: printer?.brand || 'Anycubic',
        layer_height_mm: 0.2,
        infill_percent: 15,
        nozzle_mm: 0.4,
        // Fallback only — the machine profile states the real build volume.
        bed_x_mm: bed.x,
        bed_y_mm: bed.y,
        bed_z_mm: bed.z,
      });

      if (response.status !== 'success' || !response.slice.gcode) {
        setError(response.slice.error ?? 'The slicer produced no result.');
        return;
      }

      const plates = response.slice.plate_count ?? 1;
      const parts = response.slice.part_count ?? 1;
      const g = response.slice.gcode;
      const total = g.slicer_filament_grams ?? g.calculated_filament_grams ?? 0;
      const density = g.density_g_cm3 ?? 1.24;
      const perTool = Object.entries(g.per_tool_filament_mm ?? {});

      setEstimate({
        basis: 'slicer',
        grams: total,
        seconds: g.slicer_print_time_seconds ?? 0,
        confidence: response.confidence?.level ?? 'MEDIUM',
        detail: [
          response.confidence?.reason ?? 'Sliced',
          // A multi-object file gets re-laid out, and how many plates that
          // took is part of what the operator is being quoted for (§20).
          plates > 1
            ? `${parts} parts across ${plates} plates — the time is their total.`
            : parts > 1 ? `${parts} parts on one plate.` : '',
        ].filter(Boolean).join(' '),
      });

      // Real per-tool weights replace the triangle-share guess. Existing spool
      // choices are preserved so a re-slice does not undo the operator's work.
      setLanes((current) =>
        perTool.length > 1
          ? perTool.map(([tool, mm], i) => ({
              toolIndex: Number(tool),
              grams: Math.round(lengthToGrams(mm, g.filament_diameter_mm, density) * 10) / 10,
              spoolId: current[i]?.spoolId ?? '',
              sourceColor: current[i]?.sourceColor ?? groups[i]?.sourceColor ?? '#2fe3b5',
            }))
          : current.length <= 1
            ? [{
                toolIndex: 0,
                grams: total,
                spoolId: current[0]?.spoolId ?? '',
                sourceColor: current[0]?.sourceColor ?? '#2fe3b5',
              }]
            // The file has colour groups but the slice used one tool: keep the
            // groups and split the sliced total across them by share.
            : current.map((lane, i) => ({
                ...lane,
                grams: Math.round(total * (groups[i]?.share ?? 1 / current.length) * 10) / 10,
              })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSlicing(null);
    }
  }

  const qty = Math.max(Number(quantity) || 1, 1);

  /** Drives the visualizer: a lane painted with its chosen spool's colour. */
  const colorOverrides = useMemo(() => {
    const out: Record<number, string> = {};
    lanes.forEach((lane, index) => {
      const spool = spools.find((s) => s.id === lane.spoolId);
      const hex = spool?.product?.color_hex;
      if (hex) out[index] = hex;
    });
    return out;
  }, [lanes, spools]);

  function assign(index: number, spoolId: string) {
    setLanes((current) => current.map((l, i) => (i === index ? { ...l, spoolId } : l)));
  }

  function setLaneGrams(index: number, grams: number) {
    setLanes((current) => current.map((l, i) => (i === index ? { ...l, grams } : l)));
  }

  const totalGrams = lanes.reduce((sum, l) => sum + l.grams, 0) * qty;

  const shortfalls = lanes.flatMap((lane) => {
    const spool = spools.find((s) => s.id === lane.spoolId);
    if (!spool) return [];
    const short = lane.grams * qty - Number(spool.remaining_grams);
    return short > 0 ? [{ code: spool.code, short }] : [];
  });

  const unassigned = lanes.filter((l) => !l.spoolId && l.grams > 0).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg || lanes.length === 0) return;
    setBusy(true);
    setError(null);

    // Checked before anything is written: a job row with no material rows has
    // an estimate of 0 and silently no-ops every stock movement, so it must
    // never be created in the first place.
    const usable = lanes.filter((l) => l.spoolId && l.grams > 0);
    if (usable.length === 0) {
      setError('Assign a spool to at least one colour before queuing the job.');
      setBusy(false);
      return;
    }

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
          estimated_seconds: (estimate?.seconds ?? 0) * qty,
          notes: model?.name ?? null,
        })
        .select()
        .single();
      if (jobErr) throw new Error(jobErr.message);

      // The trigger on this table is what fills the job's own estimated_grams.
      const { error: matErr } = await supabase.from('print_job_materials').insert(
        usable.map((l, i) => ({
          organization_id: activeOrg.id,
          job_id: (job as { id: string }).id,
          spool_id: l.spoolId,
          tool_index: i,
          estimated_grams: l.grams * qty,
        })),
      );
      if (matErr) throw new Error(matErr.message);

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Capped against the viewport so the dialog never exceeds the window.
    <Modal title="New print job" onClose={onClose} width="w-[min(900px,92vw)]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Model">
            <select className="field" value={modelId} onChange={(e) => {
              setModelId(e.target.value);
              setEstimate(null);
              setLanes([]);
            }}>
              <option value="">Choose a model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.versions.length > 0
                    ? ` · v${Math.max(...m.versions.map((v) => v.version))}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Printer">
            <select className="field" value={printerId}
                    onChange={(e) => setPrinterId(e.target.value)}>
              <option value="">Unassigned</option>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.color_slots > 1 ? ` · ${p.color_slots} colours` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input required type="number" min="1" className="field" value={quantity}
                   onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>

        {model && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {mesh ? (
                <Visualizer
                  buffer={mesh.buffer}
                  filename={mesh.filename}
                  bed={bed}
                  colorOverrides={colorOverrides}
                  onGroups={handleGroups}
                  height={340}
                />
              ) : (
                <div className="grid h-[340px] place-items-center rounded-lg border border-line
                                bg-ink-950/50 text-xs text-slate-600">
                  {loadingMesh ? 'Loading model…' : 'No source file to preview.'}
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-4">
              <div className="rounded-lg border border-line bg-ink-950/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="label mb-0">Estimate</p>
                  <button type="button" onClick={() => void runSlice()}
                          disabled={!mesh || slicing !== null}
                          className="btn-ghost px-3 py-1.5 text-xs">
                    {slicing ?? (estimate?.basis === 'slicer' ? 'Re-slice' : 'Slice')}
                  </button>
                </div>

                <div className="mt-3 flex items-baseline gap-5">
                  <div>
                    <p className="tabular text-xl font-semibold text-slate-100">
                      <Grams value={totalGrams} />
                    </p>
                    <p className="text-[11px] text-slate-500">material</p>
                  </div>
                  <div>
                    <p className="tabular text-xl font-semibold text-slate-100">
                      {formatDuration((estimate?.seconds ?? 0) * qty)}
                    </p>
                    <p className="text-[11px] text-slate-500">print time</p>
                  </div>
                </div>

                {estimate && (
                  <>
                    <div className="mt-2">
                      <Badge tone={
                        estimate.confidence === 'HIGH' ? 'mint'
                          : estimate.confidence === 'LOW' ? 'amber' : 'slate'
                      }>
                        {estimate.basis === 'slicer' ? 'Sliced' : 'Geometry'} · {estimate.confidence}
                      </Badge>
                    </div>
                    <p className="mt-2 break-words text-xs text-slate-500">{estimate.detail}</p>
                  </>
                )}
              </div>

              <div className="rounded-lg border border-line bg-ink-950/50 p-4">
                <div className="flex items-center justify-between">
                  <p className="label mb-0">
                    {lanes.length > 1 ? `${lanes.length} colours` : 'Filament'}
                  </p>
                  {printer && printer.color_slots > 1 && (
                    <span className="shrink-0 text-[11px] text-slate-600">
                      {printer.color_slots} slots
                    </span>
                  )}
                </div>

                {lanes.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Colours appear once the model loads.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {lanes.map((lane, index) => {
                      const spool = spools.find((s) => s.id === lane.spoolId);
                      const swatch = spool?.product?.color_hex ?? lane.sourceColor;
                      const need = lane.grams * qty;
                      const short = spool ? need - Number(spool.remaining_grams) : 0;
                      return (
                        <div key={index} className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-4 w-4 shrink-0 rounded border border-white/20"
                              style={{ background: swatch }}
                              aria-hidden="true"
                            />
                            <select
                              className="field flex-1 py-1.5 text-xs"
                              value={lane.spoolId}
                              onChange={(e) => assign(index, e.target.value)}
                              aria-label={`Spool for colour ${index + 1}`}
                            >
                              <option value="">Choose a spool…</option>
                              {spools.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.product?.color_name ?? s.product?.name ?? s.code} ·{' '}
                                  {Math.round(Number(s.remaining_grams))} g
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2 pl-6">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              className="field w-24 py-1 text-xs"
                              value={lane.grams}
                              onChange={(e) => setLaneGrams(index, Number(e.target.value) || 0)}
                              aria-label={`Grams for colour ${index + 1}`}
                            />
                            <span className="text-[11px] text-slate-600">
                              g each · {need.toFixed(0)} g total
                            </span>
                            {short > 0 && (
                              <span className="ml-auto text-[11px] text-red-400">
                                {short.toFixed(0)} g short
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {model && estimate && (
          <JobAdvisor
            modelId={model.id}
            printerId={printerId || null}
            quantity={qty}
            unitSeconds={estimate.seconds}
            unitGrams={lanes.reduce((sum, l) => sum + l.grams, 0)}
            maxPerPlate={10}
          />
        )}

        {shortfalls.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Not enough material:{' '}
            {shortfalls.map((s) => `${s.code} is ${s.short.toFixed(0)} g short`).join(', ')}.
            Pick a different spool for that colour.
          </div>
        )}
        {unassigned > 0 && shortfalls.length === 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3
                          text-sm text-amber-300">
            {unassigned} colour{unassigned > 1 ? 's have' : ' has'} no spool yet. A job with no
            spool assigned reserves and consumes nothing, so its material never reaches the
            ledger — pick a spool for every colour before queuing it.
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          {/* Unassigned colours are blocked, not warned about: a job that
              cannot move stock is one the ledger can never account for. */}
          <button type="submit"
                  disabled={busy || !model || lanes.length === 0 || unassigned > 0
                            || shortfalls.length > 0}
                  className="btn-primary">
            {busy ? 'Queuing…' : 'Queue job'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
