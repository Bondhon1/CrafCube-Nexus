import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomBuild, CustomDesign, FilamentSpool, Model, ModelFile, ModelVersion, Printer, StoredSlice, WasteKind,
} from '@crafcube/types';
import {
  CUSTOM_BUILD_SOURCE_LABELS, WASTE_KINDS, WASTE_KIND_LABELS, formatDuration,
  sliceSettingsKey, toolWasteForJob, wastePercent,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { objectStore } from '@/lib/storage';
import { Badge, ErrorNote, Field, Grams, Modal } from '@/components/ui';
import { JobAdvisor } from '@/components/JobAdvisor';
import { Visualizer, type ColorGroup } from '@/components/Visualizer';
import { describeSetup, useSlicerSetup } from '@/lib/slicerSetup';
import { findStoredSlice, jobSliceSettings, sha256Hex, sliceAndStore } from '@/lib/slices';

interface VersionWithFiles extends ModelVersion {
  files: ModelFile[];
}
interface ModelWithVersions extends Model {
  versions: VersionWithFiles[];
}
type SpoolOption = FilamentSpool & {
  product: { name: string; color_hex: string | null; color_name: string | null } | null;
};

type WasteGrams = Record<`${WasteKind}_g`, number>;

/** One colour of the job: a filament slot, what it consumes, and its spool. */
interface Lane {
  toolIndex: number;
  /** Everything this spool gives up per copy — product and waste. */
  grams: number;
  waste: WasteGrams;
  spoolId: string;
  /** Colour the file carried, so a lane without a spool still looks right. */
  sourceColor: string;
}

type Mode = 'library' | 'custom';

const NO_WASTE: WasteGrams = { purge_g: 0, support_g: 0, skirt_brim_g: 0, prime_line_g: 0 };
const FALLBACK_COLOUR = '#2fe3b5';

export function NewJobModal({
  onClose, onSaved, initialBuildId,
}: {
  onClose: () => void;
  onSaved: () => void;
  /** Opens straight onto a custom build, from the custom builds screen. */
  initialBuildId?: string;
}) {
  const { activeOrg } = useSession();
  const setup = useSlicerSetup();
  const setupReady = setup === null || setup.phase === 'ready' || setup.phase === 'installed';

  const [mode, setMode] = useState<Mode>(initialBuildId ? 'custom' : 'library');
  const [models, setModels] = useState<ModelWithVersions[]>([]);
  const [builds, setBuilds] = useState<CustomBuild[]>([]);
  const [designs, setDesigns] = useState<CustomDesign[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [spools, setSpools] = useState<SpoolOption[]>([]);

  const [modelId, setModelId] = useState('');
  const [buildId, setBuildId] = useState(initialBuildId ?? '');
  /** The design a newly dropped file is filed under. */
  const [designId, setDesignId] = useState('');
  const [dropped, setDropped] = useState<{ buffer: ArrayBuffer; filename: string; sha: string } | null>(null);
  const [printerId, setPrinterId] = useState('');
  const [quantity, setQuantity] = useState('1');

  const [libraryMesh, setLibraryMesh] = useState<{ buffer: ArrayBuffer; filename: string } | null>(null);
  const [groups, setGroups] = useState<ColorGroup[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [slice, setSlice] = useState<StoredSlice | null>(null);
  const [sliceOrigin, setSliceOrigin] = useState<'stored' | 'new' | null>(null);
  const [loadingMesh, setLoadingMesh] = useState(false);
  const [slicing, setSlicing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeOrg) return;
    void (async () => {
      const [m, p, s, b, d] = await Promise.all([
        supabase.from('models')
          .select('*, versions:model_versions(*, files:model_files(*))')
          .eq('organization_id', activeOrg.id).eq('archived', false).order('name'),
        supabase.from('printers').select('*').eq('organization_id', activeOrg.id)
          .neq('status', 'retired').order('name'),
        supabase.from('filament_spools')
          .select('*, product:filament_products(name, color_hex, color_name)')
          .eq('organization_id', activeOrg.id).in('status', ['sealed', 'in_use']).order('code'),
        supabase.from('custom_builds').select('*')
          .eq('organization_id', activeOrg.id).neq('status', 'archived')
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('custom_designs').select('*')
          .eq('organization_id', activeOrg.id).eq('archived', false).order('product_code'),
      ]);
      setModels((m.data ?? []) as unknown as ModelWithVersions[]);
      setPrinters((p.data ?? []) as Printer[]);
      setSpools((s.data ?? []) as unknown as SpoolOption[]);
      setBuilds((b.data ?? []) as CustomBuild[]);
      setDesigns((d.data ?? []) as CustomDesign[]);
      setPrinterId((c) => c || (p.data?.[0] as Printer | undefined)?.id || '');
    })();
  }, [activeOrg]);

  const model = models.find((m) => m.id === modelId);
  const version = useMemo(
    () => (model ? [...model.versions].sort((a, b) => b.version - a.version)[0] : undefined),
    [model],
  );
  const source = version?.files.find((f) => f.kind === 'source' || f.kind === 'mesh');
  const build = builds.find((b) => b.id === buildId);
  const designCode = useCallback(
    (id: string) => designs.find((d) => d.id === id)?.product_code ?? '',
    [designs],
  );
  const printer = printers.find((p) => p.id === printerId);
  const settings = useMemo(() => jobSliceSettings(printer), [printer]);
  const settingsKey = sliceSettingsKey(settings);

  const bed = useMemo(() => ({
    x: Number(printer?.build_x_mm ?? 260),
    y: Number(printer?.build_y_mm ?? 260),
    z: Number(printer?.build_z_mm ?? 260),
  }), [printer]);

  // What is being sliced: its content hash, its name, and its bytes if we have
  // them. A custom build from the studio has a hash but, until someone drops
  // its file here, no bytes.
  const target = useMemo(() => {
    if (mode === 'library') {
      return source
        ? { sha: source.sha256, name: source.filename, buffer: libraryMesh?.buffer ?? null }
        : null;
    }
    const sha = build?.file_sha256 ?? dropped?.sha ?? null;
    if (!sha) return null;
    const buffer = dropped && dropped.sha === sha ? dropped.buffer : null;
    return { sha, name: build?.file_name ?? dropped?.filename ?? 'model.3mf', buffer };
  }, [mode, source, libraryMesh, build, dropped]);

  const preview = mode === 'library'
    ? libraryMesh
    : dropped && target && dropped.sha === target.sha
      ? { buffer: dropped.buffer, filename: dropped.filename }
      : null;

  // Library models live in storage; download the file for preview and slicing.
  useEffect(() => {
    if (mode !== 'library' || !source) { setLibraryMesh(null); return; }
    let cancelled = false;
    setLoadingMesh(true);
    setError(null);
    void (async () => {
      try {
        const blob = await objectStore.download(source.storage_key);
        if (!cancelled) setLibraryMesh({ buffer: await blob.arrayBuffer(), filename: source.filename });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoadingMesh(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, source]);

  /**
   * Use the stored slice if there is one; slice only when there is not.
   *
   * Opening the same job twice must show the same numbers, and a one-off build
   * whose file was never kept has no other way to have numbers at all.
   */
  useEffect(() => {
    if (!activeOrg || !target) { setSlice(null); setSliceOrigin(null); return; }
    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        setSlicing('Looking for a stored slice…');
        const stored = await findStoredSlice(activeOrg.id, target.sha, settings);
        if (cancelled) return;
        if (stored) {
          setSlice(stored);
          setSliceOrigin('stored');
          return;
        }
        setSlice(null);
        setSliceOrigin(null);
        if (!target.buffer || !setupReady) return;

        setSlicing('Slicing…');
        const fresh = await sliceAndStore({
          organizationId: activeOrg.id, buffer: target.buffer, fileName: target.name,
          fileSha256: target.sha, settings, bed,
        });
        if (!cancelled) {
          setSlice(fresh);
          setSliceOrigin('new');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setSlicing(null);
      }
    })();

    return () => { cancelled = true; };
    // bed and settings are captured through settingsKey and the printer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg, target?.sha, target?.buffer, settingsKey, setupReady]);

  /** The only way a stored slice is replaced: someone asks for it. */
  async function reslice() {
    if (!activeOrg || !target?.buffer) return;
    setError(null);
    setSlicing('Slicing…');
    try {
      const fresh = await sliceAndStore({
        organizationId: activeOrg.id, buffer: target.buffer, fileName: target.name,
        fileSha256: target.sha, settings, bed,
      });
      setSlice(fresh);
      setSliceOrigin('new');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSlicing(null);
    }
  }

  const colourFor = useCallback((index: number) =>
    build?.colours?.[index]?.hex ?? groups[index]?.sourceColor ?? FALLBACK_COLOUR,
  [build, groups]);

  // Lanes follow the slice: one per filament it used, keeping spool choices.
  useEffect(() => {
    if (!slice) { setLanes([]); return; }
    const tools = slice.per_tool.length > 0
      ? slice.per_tool
      : [{ tool: 0, total_g: Number(slice.total_grams), ...NO_WASTE }];
    setLanes((current) => tools.map((t, i) => ({
      toolIndex: t.tool,
      grams: Number(t.total_g),
      waste: {
        purge_g: Number(t.purge_g) || 0,
        support_g: Number(t.support_g) || 0,
        skirt_brim_g: Number(t.skirt_brim_g) || 0,
        prime_line_g: Number(t.prime_line_g) || 0,
      },
      spoolId: current[i]?.spoolId ?? '',
      sourceColor: FALLBACK_COLOUR,
    })));
  }, [slice]);

  // Colours arrive after the preview loads. Only the swatch follows them —
  // rebuilding the lanes here would throw away weights the operator edited.
  useEffect(() => {
    setLanes((current) => current.map((lane) => ({ ...lane, sourceColor: colourFor(lane.toolIndex) })));
  }, [colourFor, slice]);

  async function acceptFile(file: File) {
    setError(null);
    const buffer = await file.arrayBuffer();
    const sha = await sha256Hex(buffer);
    setDropped({ buffer, filename: file.name, sha });
    // A file the studio already sent is recognised by its content, whatever
    // it is called on this computer.
    const known = builds.find((b) => b.file_sha256 === sha);
    setBuildId(known?.id ?? '');
  }

  const qty = Math.max(Number(quantity) || 1, 1);

  const colorOverrides = useMemo(() => {
    const out: Record<number, string> = {};
    lanes.forEach((lane, index) => {
      const hex = spools.find((s) => s.id === lane.spoolId)?.product?.color_hex;
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
  const title = mode === 'library' ? model?.name : build?.title ?? dropped?.filename.replace(/\.[^.]+$/, '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg || lanes.length === 0 || !slice) return;
    setBusy(true);
    setError(null);

    const usable = lanes.filter((l) => l.spoolId && l.grams > 0);
    if (usable.length === 0) {
      setError('Assign a spool to at least one colour before queuing the job.');
      setBusy(false);
      return;
    }

    try {
      let customBuildId: string | null = mode === 'custom' ? buildId || null : null;
      // A dropped file nobody has seen before becomes a build here — its
      // description and slice are kept; the file is not.
      if (mode === 'custom' && !customBuildId && dropped) {
        if (!designId) throw new Error('Choose which design this build is, so it sells under its product code.');
        const { data, error: buildErr } = await supabase.from('custom_builds').insert({
          organization_id: activeOrg.id,
          design_id: designId,
          source: 'manual',
          title: title || 'Custom build',
          file_name: dropped.filename,
          file_sha256: dropped.sha,
          colours: lanes.map((l) => ({ hex: l.sourceColor })),
        }).select().single();
        if (buildErr) throw new Error(buildErr.message);
        customBuildId = (data as CustomBuild).id;
      }

      const { data: code, error: codeErr } = await supabase.rpc('next_job_code', { p_org: activeOrg.id });
      if (codeErr) throw new Error(codeErr.message);

      const { data: job, error: jobErr } = await supabase.from('print_jobs').insert({
        organization_id: activeOrg.id,
        code,
        model_version_id: mode === 'library' ? version?.id ?? null : null,
        custom_build_id: customBuildId,
        slice_result_id: slice.id,
        printer_id: printerId || null,
        quantity: qty,
        estimated_seconds: slice.print_seconds * qty,
        notes: title ?? null,
      }).select().single();
      if (jobErr) throw new Error(jobErr.message);

      // The trigger on this table fills the job's own totals, waste included.
      const { error: matErr } = await supabase.from('print_job_materials').insert(
        usable.map((l, i) => ({
          organization_id: activeOrg.id,
          job_id: (job as { id: string }).id,
          spool_id: l.spoolId,
          tool_index: i,
          estimated_grams: l.grams * qty,
          estimated_waste: toolWasteForJob(l.waste, qty),
        })),
      );
      if (matErr) throw new Error(matErr.message);

      if (customBuildId) {
        await supabase.from('custom_builds').update({ status: 'queued' })
          .eq('id', customBuildId).eq('status', 'new');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const waste = slice?.waste ?? {};
  const shownWaste = WASTE_KINDS.filter((k) => Number(waste[`${k}_g`] ?? 0) > 0);
  const share = slice ? wastePercent(slice) : null;
  const ready = mode === 'library' ? Boolean(model) : Boolean(target);

  return (
    <Modal title="New print job" onClose={onClose} width="w-[min(900px,92vw)]">
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />

        <div className="flex gap-1 rounded-lg border border-line p-1" role="tablist">
          {(['library', 'custom'] as Mode[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m}
                    onClick={() => { setMode(m); setSlice(null); setLanes([]); }}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                      mode === m ? 'bg-mint/10 text-mint' : 'text-slate-500 hover:text-slate-300'}`}>
              {m === 'library' ? 'Model from the library' : 'Custom one-off'}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {mode === 'library' ? (
            <Field label="Model">
              <select className="field" value={modelId}
                      onChange={(e) => { setModelId(e.target.value); setSlice(null); setLanes([]); }}>
                <option value="">Choose a model…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.product_code} · {m.name}
                    {m.versions.length > 0 ? ` · v${Math.max(...m.versions.map((v) => v.version))}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Build">
              <select className="field" value={buildId}
                      onChange={(e) => { setBuildId(e.target.value); setSlice(null); setLanes([]); }}>
                <option value="">{dropped ? `New: ${dropped.filename}` : 'Choose a build, or drop a file…'}</option>
                {builds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {designCode(b.design_id)} · {b.title} · {CUSTOM_BUILD_SOURCE_LABELS[b.source]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {mode === 'custom' && !buildId && dropped && (
            <Field label="Design" hint="The product code this build sells under.">
              <select required className="field" value={designId} onChange={(e) => setDesignId(e.target.value)}>
                <option value="">Choose a design…</option>
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>{d.product_code} · {d.name}</option>
                ))}
              </select>
              {designs.length === 0 && (
                <p className="mt-1 text-xs text-amber-300">No designs yet. Add one under Models → Custom builds.</p>
              )}
            </Field>
          )}
          <Field label="Printer">
            <select className="field" value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
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

        {(ready || mode === 'custom') && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {preview ? (
                <Visualizer buffer={preview.buffer} filename={preview.filename} bed={bed}
                            colorOverrides={colorOverrides} onGroups={setGroups} height={340} />
              ) : mode === 'custom' ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) void acceptFile(file);
                  }}
                  onClick={() => fileInput.current?.click()}
                  className="grid h-[340px] cursor-pointer place-items-center rounded-lg border-2
                             border-dashed border-line bg-ink-950/50 px-6 text-center
                             transition-colors hover:border-mint/40"
                >
                  <div>
                    {build && (
                      <>
                        <p className="text-sm font-medium text-slate-200">{build.title}</p>
                        <div className="mt-2 flex justify-center gap-1.5">
                          {build.colours.map((c, i) => (
                            <span key={i} className="h-4 w-4 rounded-full border border-white/20"
                                  style={{ background: c.hex }} title={c.name ?? c.hex} />
                          ))}
                        </div>
                      </>
                    )}
                    <p className="mt-3 text-sm text-slate-400">
                      {build && slice
                        ? 'Sliced already. Drop its file only if you want to re-slice.'
                        : build
                          ? `Drop ${build.file_name ?? 'its file'} to slice it once.`
                          : 'Drop an STL or 3MF, or click to choose.'}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      The file is sliced and its numbers kept. The file itself is never stored.
                    </p>
                  </div>
                  <input ref={fileInput} type="file" accept=".3mf,.stl,.obj" className="hidden"
                         onChange={(e) => {
                           const file = e.target.files?.[0];
                           if (file) void acceptFile(file);
                           e.target.value = '';
                         }} />
                </div>
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
                  <button type="button" onClick={() => void reslice()}
                          disabled={!target?.buffer || slicing !== null || !setupReady}
                          title={target?.buffer
                            ? 'Slice again and replace the stored result'
                            : 'Re-slicing needs the file, which is not kept'}
                          className="btn-ghost px-3 py-1.5 text-xs">
                    {slicing === 'Slicing…' ? 'Slicing…' : 'Re-slice'}
                  </button>
                </div>

                <div className="mt-3 flex items-baseline gap-5">
                  <div>
                    <p className="tabular text-xl font-semibold text-slate-100">
                      {slice ? <Grams value={totalGrams} /> : <span className="text-slate-600">—</span>}
                    </p>
                    <p className="text-[11px] text-slate-500">filament used</p>
                  </div>
                  <div>
                    <p className="tabular text-xl font-semibold text-slate-100">
                      {slice ? formatDuration(slice.print_seconds * qty)
                        : <span className="text-slate-600">—</span>}
                    </p>
                    <p className="text-[11px] text-slate-500">print time</p>
                  </div>
                </div>

                {slice && (
                  <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>In the part</span>
                      <span className="tabular"><Grams value={Number(slice.product_grams) * qty} /></span>
                    </div>
                    {shownWaste.length === 0 ? (
                      <div className="flex justify-between text-slate-500">
                        <span>Waste</span><span>none</span>
                      </div>
                    ) : shownWaste.map((kind) => (
                      <div key={kind} className="flex justify-between text-amber-300/90">
                        <span>
                          {WASTE_KIND_LABELS[kind]}
                          {kind === 'purge' && slice.tool_changes > 0
                            && ` · ${slice.tool_changes} change${slice.tool_changes === 1 ? '' : 's'}`}
                        </span>
                        <span className="tabular">
                          <Grams value={Number(waste[`${kind}_g`]) * qty} />
                        </span>
                      </div>
                    ))}
                    {share !== null && share > 0 && (
                      <p className="pt-1 text-[11px] text-slate-500">
                        {share}% of the filament never ends up in the part.
                      </p>
                    )}
                  </div>
                )}

                {!slice && (
                  <p className="mt-2 text-xs text-slate-500">
                    {slicing
                      ? slicing
                      : !setupReady
                        ? `${describeSetup(setup) ?? 'Setting up the slicer'}. This job slices as soon as it is ready.`
                        : mode === 'custom' && target && !target.buffer
                          ? 'Not sliced yet. Drop the file to slice it once.'
                          : target
                            ? 'No figure yet. Re-slice, or check the engine on Settings → Slicer.'
                            : 'Choose something to print.'}
                  </p>
                )}

                {slice && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone={slice.confidence === 'HIGH' ? 'mint'
                      : slice.confidence === 'LOW' ? 'amber' : 'slate'}>
                      {sliceOrigin === 'stored' ? 'Stored slice' : 'Sliced now'} · {slice.confidence}
                    </Badge>
                    <span className="text-[11px] text-slate-600">
                      {new Date(slice.sliced_at).toLocaleString(undefined,
                        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-line bg-ink-950/50 p-4">
                <div className="flex items-center justify-between">
                  <p className="label mb-0">{lanes.length > 1 ? `${lanes.length} colours` : 'Filament'}</p>
                  {printer && printer.color_slots > 1 && (
                    <span className="shrink-0 text-[11px] text-slate-600">{printer.color_slots} slots</span>
                  )}
                </div>

                {lanes.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">Colours appear once it is sliced.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {lanes.map((lane, index) => {
                      const spool = spools.find((s) => s.id === lane.spoolId);
                      const swatch = spool?.product?.color_hex ?? lane.sourceColor;
                      const need = lane.grams * qty;
                      const short = spool ? need - Number(spool.remaining_grams) : 0;
                      const laneWaste = Object.values(lane.waste).reduce((a, b) => a + b, 0) * qty;
                      return (
                        <div key={index} className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="h-4 w-4 shrink-0 rounded border border-white/20"
                                  style={{ background: swatch }} aria-hidden="true" />
                            <select className="field flex-1 py-1.5 text-xs" value={lane.spoolId}
                                    onChange={(e) => assign(index, e.target.value)}
                                    aria-label={`Spool for colour ${index + 1}`}>
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
                            <input type="number" step="0.1" min="0" className="field w-24 py-1 text-xs"
                                   value={lane.grams}
                                   onChange={(e) => setLaneGrams(index, Number(e.target.value) || 0)}
                                   aria-label={`Grams for colour ${index + 1}`} />
                            <span className="text-[11px] text-slate-600">
                              g each · {need.toFixed(1)} g
                              {laneWaste > 0 && ` (${laneWaste.toFixed(1)} waste)`}
                            </span>
                            {short > 0 && (
                              <span className="ml-auto text-[11px] text-red-400">{short.toFixed(0)} g short</span>
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

        {slice && (
          <JobAdvisor
            modelId={mode === 'library' ? model?.id ?? null : null}
            printerId={printerId || null}
            quantity={qty}
            unitSeconds={slice.print_seconds}
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
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {unassigned} colour{unassigned > 1 ? 's have' : ' has'} no spool yet. A job with no
            spool assigned reserves and consumes nothing, so its material never reaches the
            ledger — pick a spool for every colour before queuing it.
          </div>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit"
                  disabled={busy || !slice || lanes.length === 0 || unassigned > 0 || shortfalls.length > 0}
                  className="btn-primary">
            {busy ? 'Queuing…' : 'Queue job'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
