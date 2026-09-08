import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Model, ModelFile, ModelVersion } from '@crafcube/types';
import { GENERATION_METHOD_LABELS, MODEL_LICENSE_LABELS } from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import { formatBytes, objectStore, sha256 } from '@/lib/storage';
import { ModelsIcon } from '@/components/icons';
import { ModelPreview, renderThumbnail } from '@/components/ModelPreview';
import {
  Badge, EmptyRow, ErrorNote, Modal, PageHeader, Panel, Row, Table, Td, Th,
} from '@/components/ui';

interface VersionWithFiles extends ModelVersion {
  files: ModelFile[];
}

interface ModelRow extends Model {
  versions: VersionWithFiles[];
}

/** Signed thumbnail URLs, resolved once per library load. */
function useThumbnails(rows: ModelRow[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});

  const keys = useMemo(() => {
    const out: Record<string, string> = {};
    for (const model of rows) {
      const latest = [...model.versions].sort((a, b) => b.version - a.version)[0];
      const thumb = latest?.files.find((f) => f.kind === 'thumbnail');
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
  const [open, setOpen] = useState<ModelRow | null>(null);
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

  const visible = rows.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      (m.category ?? '').toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      <PageHeader
        title="Model library"
        subtitle="Every model is a reusable record. Versions are kept, never overwritten."
        actions={
          <>
            <input
              className="field w-40 sm:w-56"
              placeholder="Search name, category, tag"
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

      <Panel>
        <Table
          head={
            <>
              <Th>Model</Th>
              <Th>Category</Th>
              <Th>Source</Th>
              <Th>License</Th>
              <Th right>Versions</Th>
              <Th right>Latest size</Th>
              <Th />
            </>
          }
        >
          {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
          {!loading && visible.length === 0 && (
            <EmptyRow colSpan={7}>
              {rows.length === 0
                ? 'No models yet. Upload an STL or 3MF to start the library.'
                : 'Nothing matches that search.'}
            </EmptyRow>
          )}
          {visible.map((m) => {
            const latest = [...m.versions].sort((a, b) => b.version - a.version)[0];
            const bytes = latest?.files.reduce((sum, f) => sum + Number(f.byte_size), 0) ?? 0;
            return (
              <Row key={m.id}>
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
                    <div>
                  <div className="whitespace-nowrap font-medium text-slate-200">{m.name}</div>
                  {latest?.width_mm ? (
                    <div className="whitespace-nowrap text-xs text-slate-500">
                      {/* Three decimals is false precision for a printed part. */}
                      {Number(latest.width_mm).toFixed(1)} × {Number(latest.depth_mm).toFixed(1)}
                      {' × '}{Number(latest.height_mm).toFixed(1)} mm
                    </div>
                  ) : (
                    <div className="text-xs text-slate-600">Not analysed yet</div>
                  )}
                    </div>
                  </div>
                </Td>
                <Td className="text-slate-400">{m.category ?? '—'}</Td>
                <Td><Badge>{GENERATION_METHOD_LABELS[m.generation_method]}</Badge></Td>
                <Td>
                  <Badge tone={m.license === 'commercial' ? 'mint'
                    : m.license === 'restricted' ? 'red' : 'slate'}>
                    {MODEL_LICENSE_LABELS[m.license]}
                  </Badge>
                </Td>
                <Td right>v{latest?.version ?? 0}</Td>
                <Td right>{bytes ? formatBytes(bytes) : '—'}</Td>
                <Td right>
                  <button onClick={() => setOpen(m)}
                          className="text-xs text-mint transition-colors hover:text-mint-500">
                    Versions
                  </button>
                </Td>
              </Row>
            );
          })}
        </Table>
      </Panel>

      {open && <VersionsModal model={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function VersionsModal({ model, onClose }: { model: ModelRow; onClose: () => void }) {
  const { activeOrg } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [mesh, setMesh] = useState<ArrayBuffer | null>(null);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const versions = [...model.versions].sort((a, b) => b.version - a.version);
  const latest = versions[0];

  // Fetch and convert the source so the preview works for 3MF and OBJ too, not
  // just STL. Thumbnails are written back, so this cost is paid once.
  useEffect(() => {
    const source = latest?.files.find((f) => f.kind === 'source' || f.kind === 'mesh');
    const bridge = window.nexus?.engine;
    if (!source || !bridge || !activeOrg) {
      setPreviewState('unavailable');
      return;
    }

    let cancelled = false;
    setPreviewState('loading');

    void (async () => {
      try {
        const blob = await objectStore.download(source.storage_key);
        const buffer = await blob.arrayBuffer();
        const stl = source.filename.toLowerCase().endsWith('.stl')
          ? buffer
          : await bridge.meshPreview(source.filename, buffer);
        if (cancelled) return;
        setMesh(stl);
        setPreviewState('idle');

        // Backfill a thumbnail for models uploaded before previews existed.
        const hasThumbnail = latest.files.some((f) => f.kind === 'thumbnail');
        if (!hasThumbnail) {
          const png = await renderThumbnail(stl);
          if (png && !cancelled) {
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
            } catch {
              // A missing thumbnail is cosmetic; never surface it as an error.
            }
          }
        }
      } catch {
        if (!cancelled) setPreviewState('unavailable');
      }
    })();

    return () => { cancelled = true; };
  }, [latest, model.id, activeOrg]);

  /**
   * The viewer sandbox blocks download links, so the file is fetched through a
   * short-lived signed URL and handed to the OS via an object URL.
   */
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

  return (
    <Modal title={model.name} onClose={onClose} width="w-[620px]">
      <ErrorNote message={error} />

      {model.description && <p className="mb-4 text-sm text-slate-400">{model.description}</p>}

      {mesh ? (
        <div className="mb-4">
          <ModelPreview buffer={mesh} height={240} />
          <p className="mt-1.5 text-center text-[11px] text-slate-600">Drag to rotate</p>
        </div>
      ) : (
        <div className="mb-4 grid h-[240px] place-items-center rounded-lg border border-line
                        bg-ink-950/50 text-xs text-slate-600">
          {previewState === 'loading'
            ? 'Preparing preview…'
            : 'Preview needs the local engine running.'}
        </div>
      )}

      <div className="space-y-3">
        {versions.map((v) => (
          <div key={v.id} className="rounded-lg border border-line bg-ink-950/50 p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-slate-100">v{v.version}</span>
              <span className="text-xs text-slate-500">
                {new Date(v.created_at).toLocaleDateString()}
              </span>
            </div>
            {v.notes && <p className="mt-1 text-sm text-slate-400">{v.notes}</p>}
            {v.prompt && (
              <p className="mt-2 rounded border border-line bg-ink-900 p-2 font-mono text-xs text-slate-500">
                {v.prompt}
              </p>
            )}

            <ul className="mt-3 space-y-1.5">
              {v.files.map((f) => (
                <li key={f.id} className="flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate text-slate-300">
                    {f.filename}
                    <span className="ml-2 text-xs text-slate-600">{formatBytes(Number(f.byte_size))}</span>
                  </span>
                  <button
                    onClick={() => void download(f)}
                    disabled={downloading === f.id}
                    className="ml-3 shrink-0 text-xs text-mint transition-colors hover:text-mint-500 disabled:opacity-50"
                  >
                    {downloading === f.id ? 'Fetching…' : 'Download'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
