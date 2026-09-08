import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DuplicateFile, GenerationMethod, Model, ModelLicense } from '@crafcube/types';
import {
  GENERATION_METHODS, GENERATION_METHOD_LABELS,
  MODEL_LICENSES, MODEL_LICENSE_LABELS,
} from '@crafcube/types';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/SessionProvider';
import {
  extensionOf, formatBytes, isSupportedModel, MODEL_EXTENSIONS,
  modelObjectKey, objectStore, sha256,
} from '@/lib/storage';
import { Badge, ErrorNote, Field, PageHeader } from '@/components/ui';
import { AnalysisPanel, EngineNotice } from '@/components/AnalysisPanel';
import { ModelPreview, renderThumbnail } from '@/components/ModelPreview';

type Stage = 'idle' | 'hashing' | 'checking' | 'analyzing' | 'uploading' | 'saving' | 'done';

/** Strips the extension and tidies separators into a readable default name. */
function nameFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function Upload() {
  const { activeOrg, can } = useSession();
  const navigate = useNavigate();
  const canWrite = can('models.write');

  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateFile | null>(null);
  const [dragging, setDragging] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [method, setMethod] = useState<GenerationMethod>('manual');
  const [tool, setTool] = useState('');
  const [prompt, setPrompt] = useState('');
  const [license, setLicense] = useState<ModelLicense>('unknown');
  const [notes, setNotes] = useState('');

  // Adding a version to an existing model rather than creating a new one.
  const [models, setModels] = useState<Model[]>([]);
  const [targetModelId, setTargetModelId] = useState('');

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Geometry analysis is best-effort: the engine is optional, so a failure here
  // must never block the upload.
  const [analysis, setAnalysis] = useState<GeometryAnalysis | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  // Kept for the preview and for rendering a thumbnail at submit time.
  const [meshBuffer, setMeshBuffer] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    void window.nexus?.engine.status().then(setEngine);
  }, []);

  useEffect(() => {
    if (!activeOrg) return;
    void supabase
      .from('models')
      .select('*')
      .eq('organization_id', activeOrg.id)
      .eq('archived', false)
      .order('name')
      .then(({ data }) => setModels((data ?? []) as Model[]));
  }, [activeOrg]);

  const accept = useCallback(async (picked: File) => {
    setError(null);
    setDuplicate(null);
    setHash(null);

    if (!isSupportedModel(picked.name)) {
      setError(`Unsupported file type. Accepts ${MODEL_EXTENSIONS.join(', ')}.`);
      return;
    }
    if (picked.size > objectStore.maxFileBytes) {
      setError(
        `${formatBytes(picked.size)} exceeds the ${formatBytes(objectStore.maxFileBytes)} limit of ` +
        `${objectStore.name}.`,
      );
      return;
    }

    setFile(picked);
    if (!name) setName(nameFromFilename(picked.name));

    // Hash before uploading so a file already stored is never sent twice (§17).
    setStage('hashing');
    const digest = await sha256(picked);
    setHash(digest);

    setStage('checking');
    if (activeOrg) {
      const { data } = await supabase.rpc('find_duplicate_file', {
        p_org: activeOrg.id,
        p_sha256: digest,
      });
      const rows = (data ?? []) as DuplicateFile[];
      if (rows.length > 0) setDuplicate(rows[0]);
    }

    // G-code is parsed rather than measured, and that path is not wired into
    // this screen yet, so only meshes are analysed here.
    const bridge = window.nexus?.engine;
    const extension = extensionOf(picked.name);

    if (bridge && extension !== '.gcode') {
      setStage('analyzing');
      try {
        // STL is drawn directly; anything else is converted by the engine,
        // which already knows how to read every supported format.
        if (extension === '.stl') {
          setMeshBuffer(await picked.arrayBuffer());
        } else {
          try {
            setMeshBuffer(await bridge.meshPreview(picked.name, await picked.arrayBuffer()));
          } catch {
            // Preview is optional; analysis below still runs.
          }
        }

        const result = await bridge.analyze(picked.name, await picked.arrayBuffer(), {
          bed_x_mm: 260,
          bed_y_mm: 260,
          bed_z_mm: 260,
          density_g_cm3: 1.24,
          infill_percent: 15,
        });
        setAnalysis(result);
      } catch (err) {
        // Surfaced as a notice, not an error: the upload is still valid.
        setEngine({
          state: 'unavailable',
          baseUrl: '',
          error: err instanceof Error ? err.message : String(err),
          capabilities: null,
        });
      }
    }

    setStage('idle');
  }, [activeOrg, name]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrg || !file || !hash) return;
    setError(null);

    try {
      let modelId = targetModelId;

      if (!modelId) {
        setStage('saving');
        const { data, error: err } = await supabase
          .from('models')
          .insert({
            organization_id: activeOrg.id,
            name: name.trim(),
            category: category.trim() || null,
            generation_method: method,
            generation_tool: tool.trim() || null,
            prompt: prompt.trim() || null,
            license,
          })
          .select()
          .single();
        if (err) throw new Error(err.message);
        modelId = (data as Model).id;
      }

      const { data: nextVersion, error: verErr } = await supabase.rpc('next_model_version', {
        p_model: modelId,
      });
      if (verErr) throw new Error(verErr.message);
      const version = Number(nextVersion) || 1;

      const { data: versionRow, error: insErr } = await supabase
        .from('model_versions')
        .insert({
          organization_id: activeOrg.id,
          model_id: modelId,
          version,
          notes: notes.trim() || null,
          generation_method: method,
          generation_tool: tool.trim() || null,
          prompt: prompt.trim() || null,
          // Null when the engine was unavailable; the analyzer can fill these
          // in later without changing anything else.
          width_mm: analysis?.geometry.dimensions.width_mm ?? null,
          depth_mm: analysis?.geometry.dimensions.depth_mm ?? null,
          height_mm: analysis?.geometry.dimensions.height_mm ?? null,
          volume_cm3: analysis?.geometry.volume_cm3 ?? null,
          triangle_count: analysis?.geometry.triangle_count ?? null,
          is_manifold: analysis?.geometry.is_watertight ?? null,
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);

      const extension = extensionOf(file.name);
      const key = modelObjectKey({
        organizationId: activeOrg.id,
        modelId,
        version,
        sha256: hash,
        extension,
      });

      // A duplicate already has these exact bytes stored, so only the database
      // reference is new — skip the transfer entirely.
      if (!duplicate) {
        setStage('uploading');
        await objectStore.upload(key, file, file.type);
      }

      // Thumbnail is best-effort (§79): a model without one is still valid, so
      // a WebGL failure must not fail the upload.
      if (meshBuffer && !duplicate) {
        const thumbnail = await renderThumbnail(meshBuffer);
        if (thumbnail) {
          const thumbKey = `${activeOrg.id}/models/${modelId}/v${version}/thumbnail.png`;
          try {
            await objectStore.upload(thumbKey, thumbnail, 'image/png');
            await supabase.from('model_files').insert({
              organization_id: activeOrg.id,
              version_id: (versionRow as { id: string }).id,
              kind: 'thumbnail',
              filename: 'thumbnail.png',
              extension: '.png',
              storage_key: thumbKey,
              byte_size: thumbnail.size,
              content_type: 'image/png',
              sha256: await sha256(thumbnail),
            });
          } catch {
            // Ignored on purpose: the model upload below still proceeds.
          }
        }
      }

      setStage('saving');
      const { error: fileErr } = await supabase.from('model_files').insert({
        organization_id: activeOrg.id,
        version_id: (versionRow as { id: string }).id,
        kind: extension === '.gcode' ? 'gcode' : 'source',
        filename: file.name,
        extension,
        storage_key: duplicate ? duplicate.storage_key : key,
        byte_size: file.size,
        content_type: file.type || null,
        sha256: hash,
      });
      if (fileErr) throw new Error(fileErr.message);

      setStage('done');
      navigate('/models/library');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('idle');
    }
  }

  if (!canWrite) {
    return (
      <div>
        <PageHeader title="Upload" />
        <p className="text-sm text-slate-400">
          Your role cannot add models. Ask an admin for production manager access.
        </p>
      </div>
    );
  }

  const busy = stage !== 'idle' && stage !== 'done';

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Upload model"
        subtitle={`Stored privately in ${objectStore.name}. Files are hashed before upload so the same model is never stored twice.`}
      />

      <ErrorNote message={error} />

      <form onSubmit={submit} className="space-y-5">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped) void accept(dropped);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? 'border-mint bg-mint/5' : 'border-line hover:border-mint/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={MODEL_EXTENSIONS.join(',')}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void accept(picked);
            }}
          />
          {file ? (
            <div>
              <p className="font-medium text-slate-100">{file.name}</p>
              <p className="mt-1 text-sm text-slate-500">
                {formatBytes(file.size)}
                {hash && <span className="ml-2 font-mono text-xs">sha256 {hash.slice(0, 12)}…</span>}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-slate-300">Drop a model here, or click to choose</p>
              <p className="mt-1 text-xs text-slate-500">
                {MODEL_EXTENSIONS.join('  ·  ')} — up to {formatBytes(objectStore.maxFileBytes)}
              </p>
            </div>
          )}
          {(stage === 'hashing' || stage === 'checking' || stage === 'analyzing') && (
            <p className="mt-3 text-xs text-mint">
              {stage === 'hashing' && 'Hashing…'}
              {stage === 'checking' && 'Checking for duplicates…'}
              {stage === 'analyzing' && 'Analysing geometry…'}
            </p>
          )}
        </div>

        {file && <EngineNotice status={engine} />}
        {meshBuffer && <ModelPreview buffer={meshBuffer} />}
        {analysis && <AnalysisPanel analysis={analysis} />}

        {duplicate && (
          <div className="rounded-lg border border-mint/30 bg-mint/10 p-4 text-sm">
            <p className="font-medium text-mint">This exact file is already stored</p>
            <p className="mt-1 text-slate-300">
              {duplicate.model_name} · v{duplicate.version} · uploaded{' '}
              {new Date(duplicate.uploaded_at).toLocaleDateString()}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Continuing links the existing object instead of uploading again, so it costs no
              extra storage.
            </p>
          </div>
        )}

        {file && (
          <>
            <div className="card space-y-4">
              <Field label="Add to">
                <select className="field" value={targetModelId}
                        onChange={(e) => setTargetModelId(e.target.value)}>
                  <option value="">Create a new model</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} — add a version</option>
                  ))}
                </select>
              </Field>

              {!targetModelId && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Model name">
                    <input required className="field" value={name}
                           onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label="Category">
                    <input className="field" value={category} placeholder="Decor"
                           onChange={(e) => setCategory(e.target.value)} />
                  </Field>
                </div>
              )}

              <Field label="Version notes">
                <input className="field" value={notes} placeholder="Thicker base, fixed overhang"
                       onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>

            <div className="card space-y-4">
              <p className="label">Provenance</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="How was it made">
                  <select className="field" value={method}
                          onChange={(e) => setMethod(e.target.value as GenerationMethod)}>
                    {GENERATION_METHODS.map((m) => (
                      <option key={m} value={m}>{GENERATION_METHOD_LABELS[m]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Tool">
                  <input className="field" value={tool} placeholder="trimesh, OpenSCAD, Meshy…"
                         onChange={(e) => setTool(e.target.value)} />
                </Field>
              </div>

              {(method === 'ai' || method === 'python') && (
                <Field label="Prompt or script reference"
                       hint="Recorded per version, so provenance survives later edits.">
                  <textarea className="field h-20 resize-none" value={prompt}
                            onChange={(e) => setPrompt(e.target.value)} />
                </Field>
              )}

              {!targetModelId && (
                <Field label="License"
                       hint="Drives what may be sold commercially. Worth setting honestly now.">
                  <select className="field" value={license}
                          onChange={(e) => setLicense(e.target.value as ModelLicense)}>
                    {MODEL_LICENSES.map((l) => (
                      <option key={l} value={l}>{MODEL_LICENSE_LABELS[l]}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {stage === 'uploading' && 'Uploading…'}
                {stage === 'saving' && 'Saving…'}
                {duplicate && stage === 'idle' && <Badge tone="mint">Upload will be skipped</Badge>}
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost"
                        onClick={() => { setFile(null); setHash(null); setDuplicate(null); }}>
                  Clear
                </button>
                <button type="submit" disabled={busy || !hash} className="btn-primary">
                  {busy ? 'Working…' : 'Add to library'}
                </button>
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
