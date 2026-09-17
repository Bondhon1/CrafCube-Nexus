import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Model, ModelFile, ModelVersion } from '@crafcube/types';
import {
  GENERATION_METHOD_LABELS, MODEL_LICENSE_LABELS, isProductCode, normalizeProductCode,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { formatBytes, objectStore, sha256 } from '@/lib/storage';
import { ModelsIcon } from '@/components/icons';
import { Visualizer } from '@/components/Visualizer';
import { Badge, EmptyRow, ErrorNote, PageHeader, Panel, Table, Td, Th } from '@/components/ui';

interface VersionWithFiles extends ModelVersion {
  files: ModelFile[];
}

interface ModelRow extends Model {
  versions: VersionWithFiles[];
}

function latestVersion(model: ModelRow): VersionWithFiles | undefined {
  return [...model.versions].sort((a, b) => b.version - a.version)[0];
}

/** Signed thumbnail URLs, resolved once per library load. */
function useThumbnails(rows: ModelRow[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});

  const keys = useMemo(() => {
    const out: Record<string, string> = {};
    for (const model of rows) {
      const thumb = latestVersion(model)?.files.find((f) => f.kind === 'thumbnail');
      if (thumb) out[model.id] = thumb.storage_key;
    }
    return out;
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(keys);
    if (entries.length === 0) return;

    void Promise.all(
      entries.map(async ([id, key]) => {
        try {
          // Long enough to browse without re-signing on every render.
          return [id, await objectStore.signedUrl(key, 3600)] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setUrls(Object.fromEntries(results.filter((r): r is [string, string] => r !== null)));
    });

    return () => { cancelled = true; };
  }, [keys]);

  return urls;
}

export function Library() {
  const { activeOrg, can } = useSession();
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('models')
      .select('*, versions:model_versions(*, files:model_files(*))')
      .eq('organization_id', activeOrg.id)
      .eq('archived', false)
      .order('name');
    if (err) setError(err.message);
    else setRows((data ?? []) as unknown as ModelRow[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { void load(); }, [load]);

  const thumbnails = useThumbnails(rows);

  const visible = useMemo(() => rows.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      m.product_code.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.category ?? '').toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    );
  }), [rows, query]);

  // Keep a selection so the preview panel is never empty when something exists.
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !visible.some((m) => m.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  const selected = rows.find((m) => m.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Model library"
        subtitle="Every model is a reusable record. Versions are kept, never overwritten."
        actions={
          <>
            <input
              className="field w-40 sm:w-56"
              placeholder="Search code, name, tag"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {can('models.write') && (
              <Link to="/models/upload" className="btn-primary">Upload model</Link>
            )}
          </>
        }
      />

      <ErrorNote message={error} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel className="min-w-0">
          <Table
            head={
              <>
                <Th>Code</Th>
                <Th>Model</Th>
                <Th>Source</Th>
                <Th>License</Th>
                <Th right>Ver</Th>
                <Th right>Size</Th>
              </>
            }
          >
            {loading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
            {!loading && visible.length === 0 && (
              <EmptyRow colSpan={6}>
                {rows.length === 0
                  ? 'No models yet. Upload an STL or 3MF to start the library.'
                  : 'Nothing matches that search.'}
              </EmptyRow>
            )}
            {visible.map((m) => {
              const latest = latestVersion(m);
              const bytes = latest?.files.reduce((sum, f) => sum + Number(f.byte_size), 0) ?? 0;
              const active = m.id === selectedId;
              return (
                <tr
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`cursor-pointer border-b border-line/60 transition-colors last:border-0 ${
                    active ? 'bg-mint/[0.07]' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <Td className="whitespace-nowrap font-mono text-xs text-mint">{m.product_code}</Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      {thumbnails[m.id] ? (
                        <img
                          src={thumbnails[m.id]}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded border border-line bg-ink-950 object-cover"
                        />
                      ) : (
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded
                                        border border-line bg-ink-950 text-slate-700">
                          <ModelsIcon size={16} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className={`truncate font-medium ${active ? 'text-mint' : 'text-slate-200'}`}>
                          {m.name}
                        </div>
                        {latest?.width_mm ? (
                          <div className="whitespace-nowrap text-xs text-slate-500">
                            {Number(latest.width_mm).toFixed(1)} × {Number(latest.depth_mm).toFixed(1)}
                            {' × '}{Number(latest.height_mm).toFixed(1)} mm
                          </div>
                        ) : (
                          <div className="text-xs text-slate-600">Not analysed yet</div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td><Badge>{GENERATION_METHOD_LABELS[m.generation_method]}</Badge></Td>
                  <Td>
                    <Badge tone={m.license === 'commercial' ? 'mint'
                      : m.license === 'restricted' ? 'red' : 'slate'}>
                      {MODEL_LICENSE_LABELS[m.license]}
                    </Badge>
                  </Td>
                  <Td right>v{latest?.version ?? 0}</Td>
                  <Td right>{bytes ? formatBytes(bytes) : '—'}</Td>
                </tr>
              );
            })}
          </Table>
        </Panel>

        <ModelPanel model={selected} onThumbnail={load} onChanged={load}
                    canEdit={can('models.write')} />
      </div>
    </div>
  );
}

/**
 * Preview and files for the selected model.
 *
 * The visualizer sits beside the table rather than inside a dialog: choosing
 * between models is a visual decision, and a modal turns comparing two of them
 * into a sequence of clicks.
 */
function ModelPanel({
  model,
  onThumbnail,
  onChanged,
  canEdit,
}: {
  model: ModelRow | null;
  onThumbnail: () => void;
  onChanged: () => void;
  canEdit: boolean;
}) {
  const { activeOrg } = useSession();
  const [mesh, setMesh] = useState<{ buffer: ArrayBuffer; filename: string } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);

  useEffect(() => { setEditingCode(null); }, [model?.id]);

  async function saveCode() {
    if (!model || editingCode === null) return;
    const code = normalizeProductCode(editingCode);
    if (!isProductCode(code)) {
      setError('A product code is 1-4 letters then 3-6 digits, like C0001.');
      return;
    }
    setError(null);
    const { error: err } = await supabase.from('models').update({ product_code: code }).eq('id', model.id);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingCode(null);
    onChanged();
  }

  const latest = model ? latestVersion(model) : undefined;
  const source = latest?.files.find((f) => f.kind === 'source' || f.kind === 'mesh');
  const sourceKey = source?.storage_key;
  const hasThumbnail = Boolean(latest?.files.some((f) => f.kind === 'thumbnail'));

  useEffect(() => {
    setMesh(null);
    setError(null);
    if (!sourceKey || !source || !activeOrg || !model || !latest) {
      setState('unavailable');
      return;
    }

    let cancelled = false;
    setState('loading');

    void (async () => {
      try {
        const blob = await objectStore.download(sourceKey);
        if (cancelled) return;
        const buffer = await blob.arrayBuffer();
        setMesh({ buffer, filename: source.filename });
        setState('idle');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setState('unavailable');
        }
      }
    })();

    return () => { cancelled = true; };
    // Keyed on the file, not the model object, so a parent re-render caused by
    // the thumbnail write does not restart the download.
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Stores the visualizer's own frame as the model's thumbnail. Backfills
   * anything uploaded before previews existed, and only ever runs once per
   * version because the guard checks for an existing thumbnail row.
   */
  const saveThumbnail = useCallback(async (png: Blob) => {
    if (!activeOrg || !model || !latest || hasThumbnail) return;
    const key = `${activeOrg.id}/models/${model.id}/v${latest.version}/thumbnail.png`;
    try {
      await objectStore.upload(key, png, 'image/png');
      await supabase.from('model_files').insert({
        organization_id: activeOrg.id,
        version_id: latest.id,
        kind: 'thumbnail',
        filename: 'thumbnail.png',
        extension: '.png',
        storage_key: key,
        byte_size: png.size,
        content_type: 'image/png',
        sha256: await sha256(png),
      });
      onThumbnail();
    } catch {
      // Cosmetic: never surface a thumbnail failure as a page error.
    }
  }, [activeOrg, model, latest, hasThumbnail, onThumbnail]);

  async function download(file: ModelFile) {
    setError(null);
    setDownloading(file.id);
    try {
      const blob = await objectStore.download(file.storage_key);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setDownloading(null);
  }

  if (!model) {
    return (
      <div className="card grid min-h-[320px] place-items-center text-sm text-slate-600">
        Select a model to preview it.
      </div>
    );
  }

  const versions = [...model.versions].sort((a, b) => b.version - a.version);

  return (
    <div className="card min-w-0 space-y-4">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-sm font-semibold text-slate-200">{model.name}</h2>
          {editingCode === null ? (
            <button type="button" disabled={!canEdit} onClick={() => setEditingCode(model.product_code)}
                    title={canEdit ? 'Change product code' : undefined}
                    className="shrink-0 rounded border border-mint/30 bg-mint/10 px-2 py-0.5 font-mono
                               text-xs text-mint enabled:hover:border-mint/60">
              {model.product_code}
            </button>
          ) : (
            <form className="flex shrink-0 items-center gap-1.5"
                  onSubmit={(e) => { e.preventDefault(); void saveCode(); }}>
              <input autoFocus className="field w-24 py-1 font-mono text-xs uppercase" value={editingCode}
                     onChange={(e) => setEditingCode(e.target.value)} aria-label="Product code" />
              <button type="submit" className="text-xs text-mint hover:text-mint-500">Save</button>
              <button type="button" className="text-xs text-slate-500 hover:text-slate-300"
                      onClick={() => setEditingCode(null)}>Cancel</button>
            </form>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {[model.category, GENERATION_METHOD_LABELS[model.generation_method]]
            .filter(Boolean).join(' · ')}
        </p>
      </div>

      <ErrorNote message={error} />

      {mesh ? (
        <Visualizer
          buffer={mesh.buffer}
          filename={mesh.filename}
          height={300}
          onSnapshot={hasThumbnail ? undefined : saveThumbnail}
        />
      ) : (
        <div className="grid h-[300px] place-items-center rounded-lg border border-line
                        bg-ink-950/50 text-xs text-slate-600">
          {state === 'loading' ? 'Loading model…' : 'No source file to preview.'}
        </div>
      )}

      <div className="space-y-2.5">
        {versions.map((v) => (
          <div key={v.id} className="rounded-lg border border-line bg-ink-950/50 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-slate-200">v{v.version}</span>
              <span className="text-[11px] text-slate-600">
                {new Date(v.created_at).toLocaleDateString()}
              </span>
            </div>
            {v.notes && <p className="mt-1 text-xs text-slate-400">{v.notes}</p>}
            <ul className="mt-2 space-y-1">
              {v.files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-slate-400">
                    {f.filename}
                    <span className="ml-1.5 text-slate-600">{formatBytes(Number(f.byte_size))}</span>
                  </span>
                  <button
                    onClick={() => void download(f)}
                    disabled={downloading === f.id}
                    className="shrink-0 text-mint transition-colors hover:text-mint-500 disabled:opacity-50"
                  >
                    {downloading === f.id ? 'Fetching…' : 'Download'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
