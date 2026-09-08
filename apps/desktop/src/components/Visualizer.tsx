import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Model visualizer, built on the approach in the 3dp viewer.
 *
 * Two things it does that a plain STL preview cannot:
 *
 *  - loads 3MF natively, which yields **one mesh per material**, so a
 *    multi-colour model arrives already separated into its colour groups;
 *  - repaints those groups on demand, so choosing a different spool updates
 *    the model immediately rather than after a round trip.
 */

// Smooth gentle curves, keep real edges hard. Averaging normals across a 90°
// corner is what makes printed parts look dented in preview.
const CREASE = THREE.MathUtils.degToRad(35);

const crease = (g: THREE.BufferGeometry) => toCreasedNormals(g.index ? g.toNonIndexed() : g, CREASE);

export interface ColorGroup {
  index: number;
  /** Colour carried by the file, as a hex string. */
  sourceColor: string;
  triangles: number;
  /** Share of total triangles — a rough proxy for material split. */
  share: number;
}

interface VisualizerProps {
  buffer: ArrayBuffer;
  filename: string;
  /** Bed size, drawn to scale so an oversized model is obvious. */
  bed?: { x: number; y: number; z: number };
  /** Overrides per group index; changing these repaints without reloading. */
  colorOverrides?: Record<number, string>;
  onGroups?: (groups: ColorGroup[]) => void;
  height?: number;
}

const DEFAULT_COLOR = '#2fe3b5';

export function Visualizer({
  buffer,
  filename,
  bed = { x: 260, y: 260, z: 260 },
  colorOverrides,
  onGroups,
  height = 320,
}: VisualizerProps) {
  const host = useRef<HTMLDivElement>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fits, setFits] = useState(true);

  // Kept in a ref so repainting never re-runs the loader.
  const overridesRef = useRef(colorOverrides);
  overridesRef.current = colorOverrides;

  const isStl = useMemo(() => filename.toLowerCase().endsWith('.stl'), [filename]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    const width = container.clientWidth || 480;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 8000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;

    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x0a1c22, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(120, 220, 160);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x0df8d0, 0.5);
    fill.position.set(-160, 90, -120);
    scene.add(fill);

    // Printer space is Z-up, three.js is Y-up; everything model-side hangs off
    // this group so the plate grid stays in XZ.
    const model = new THREE.Group();
    model.rotation.x = -Math.PI / 2;
    scene.add(model);

    // Build plate, drawn to the printer's real size.
    const plate = new THREE.Group();
    const grid = new THREE.GridHelper(
      Math.max(bed.x, bed.y),
      Math.round(Math.max(bed.x, bed.y) / 20),
      0x1b4a56,
      0x12303a,
    );
    grid.position.y = -0.01;
    plate.add(grid);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(bed.x, bed.y),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    plate.add(shadowPlane);
    const volume = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bed.x, bed.z, bed.y)),
      new THREE.LineBasicMaterial({ color: 0x12303a }),
    );
    volume.position.y = bed.z / 2;
    plate.add(volume);
    scene.add(plate);

    let disposed = false;
    let frame = 0;

    void (async () => {
      let object: THREE.Object3D;
      try {
        if (isStl) {
          const geometry = crease(new STLLoader().parse(buffer));
          object = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, roughness: 0.62, metalness: 0.04 }),
          );
        } else {
          // 3MF returns a group with one mesh per material, which is exactly
          // the colour separation the job form needs.
          object = new ThreeMFLoader().parse(buffer);
          object.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) mesh.geometry = crease(mesh.geometry);
          });
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'Could not read this model.');
        return;
      }
      if (disposed) return;

      const meshes: THREE.Mesh[] = [];
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        meshes.push(mesh);
      });
      meshesRef.current = meshes;

      const groups: ColorGroup[] = [];
      let totalTriangles = 0;
      for (const mesh of meshes) {
        totalTriangles += (mesh.geometry.getAttribute('position')?.count ?? 0) / 3;
      }
      meshes.forEach((mesh, index) => {
        const source = mesh.material as THREE.MeshStandardMaterial | undefined;
        const sourceColor = source?.color ? `#${source.color.getHexString()}` : DEFAULT_COLOR;
        const triangles = (mesh.geometry.getAttribute('position')?.count ?? 0) / 3;

        // The file's own material is replaced so every model shares one look
        // and can be repainted from the spool selection.
        mesh.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(overridesRef.current?.[index] ?? sourceColor),
          roughness: 0.62,
          metalness: 0.04,
        });

        groups.push({
          index,
          sourceColor,
          triangles: Math.round(triangles),
          share: totalTriangles > 0 ? triangles / totalTriangles : 1,
        });
      });

      model.add(object);

      // Sit the model on the plate, centred. Foreign files carry their own
      // build transforms, often for a different bed.
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      const centre = box.getCenter(new THREE.Vector3());
      const origin = model.worldToLocal(new THREE.Vector3(0, 0, 0));
      const delta = model
        .worldToLocal(new THREE.Vector3(-centre.x, -box.min.y, -centre.z))
        .sub(origin);
      object.position.copy(delta);

      const size = box.getSize(new THREE.Vector3());
      // The box above was measured before centring; frame against where the
      // model actually ended up, or it sits off to one side of the viewport.
      object.updateMatrixWorld(true);
      const placed = new THREE.Box3().setFromObject(object);
      const focus = placed.getCenter(new THREE.Vector3());

      setFits(size.x <= bed.x && size.z <= bed.y && size.y <= bed.z);

      // Frame the model, not the plate: a 130 mm part on a 260 mm bed is
      // unreadable if the camera pulls back far enough to show the whole bed.
      const radius = Math.max(size.x, size.y, size.z) || 1;
      const distance = radius * 1.9;
      camera.position.set(
        focus.x + distance * 0.75,
        focus.y + distance * 0.6,
        focus.z + distance * 0.85,
      );
      controls.target.copy(focus);
      controls.update();

      onGroups?.(groups);
    })();

    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth || width;
      renderer.setSize(w, height, false);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      // WebGL contexts are scarce; a leak per open eventually stops the app
      // rendering anything at all.
      for (const mesh of meshesRef.current) {
        mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
      meshesRef.current = [];
      renderer.domElement.remove();
      renderer.dispose();
    };
  }, [buffer, filename, isStl, bed.x, bed.y, bed.z, height, onGroups]);

  // Repaint without reloading — this is what makes swapping a spool feel live.
  useEffect(() => {
    meshesRef.current.forEach((mesh, index) => {
      const override = colorOverrides?.[index];
      if (!override) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material?.color) material.color.set(override);
    });
  }, [colorOverrides]);

  if (error) {
    return (
      <div className="grid place-items-center rounded-lg border border-line bg-ink-950/50
                      text-xs text-slate-500"
           style={{ height }}>
        {error}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={host}
        className="cursor-grab overflow-hidden rounded-lg border border-line bg-ink-950/50
                   active:cursor-grabbing"
        style={{ height }}
      />
      {!fits && (
        <span className="absolute left-3 top-3 rounded border border-red-500/40 bg-red-500/15
                         px-2 py-1 text-[11px] text-red-300">
          Exceeds the build volume
        </span>
      )}
      <p className="mt-1.5 text-center text-[11px] text-slate-600">
        Drag to orbit · scroll to zoom
      </p>
    </div>
  );
}
