import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * 3D preview and thumbnail rendering (design doc §79, §80).
 *
 * The mesh is parsed and rendered in the renderer process rather than round-
 * tripping through the engine: the bytes are already in hand at upload time,
 * and a WebGL render is far cheaper than shipping an image back over HTTP.
 */

/** Parses binary or ASCII STL into a BufferGeometry. */
export function parseStl(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer);

  // An ASCII STL starts with "solid", but so can a binary one, so the header is
  // not conclusive. The reliable test is whether the declared triangle count
  // matches the file length exactly.
  const isBinary = (() => {
    if (buffer.byteLength < 84) return false;
    const triangles = view.getUint32(80, true);
    return 84 + triangles * 50 === buffer.byteLength;
  })();

  return isBinary ? parseBinaryStl(view) : parseAsciiStl(new TextDecoder().decode(buffer));
}

function parseBinaryStl(view: DataView): THREE.BufferGeometry {
  const triangles = view.getUint32(80, true);
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);

  let offset = 84;
  for (let i = 0; i < triangles; i += 1) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    for (let v = 0; v < 3; v += 1) {
      const base = i * 9 + v * 3;
      positions[base] = view.getFloat32(offset, true);
      positions[base + 1] = view.getFloat32(offset + 4, true);
      positions[base + 2] = view.getFloat32(offset + 8, true);
      normals[base] = nx;
      normals[base + 1] = ny;
      normals[base + 2] = nz;
      offset += 12;
    }
    offset += 2; // attribute byte count
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function parseAsciiStl(text: string): THREE.BufferGeometry {
  const positions: number[] = [];
  const pattern = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    positions.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Face normals are recomputed rather than trusted: many exporters write them
  // inconsistently, which shows up as black patches under lighting.
  geometry.computeVertexNormals();
  return geometry;
}

interface SceneParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mesh: THREE.Mesh;
}

/** Builds a lit scene framed on the model, sized to the given viewport. */
function buildScene(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
  canvas?: HTMLCanvasElement,
): SceneParts {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // required to read pixels back for a thumbnail
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();

  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Centre the geometry on the origin so orbiting stays stable regardless of
  // where the exporter placed the model.
  geometry.translate(-center.x, -center.y, -center.z);

  const material = new THREE.MeshStandardMaterial({
    color: 0x2fe3b5,
    metalness: 0.15,
    roughness: 0.55,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // STL is Z-up; three.js is Y-up.
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(1, 1.4, 1);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x0df8d0, 0.7);
  rim.position.set(-1.2, 0.3, -1);
  scene.add(rim);

  const radius = Math.max(size.x, size.y, size.z) || 1;
  const camera = new THREE.PerspectiveCamera(40, width / height, radius / 100, radius * 20);
  const distance = radius * 1.9;
  camera.position.set(distance * 0.8, distance * 0.65, distance * 0.9);
  camera.lookAt(0, 0, 0);

  return { renderer, scene, camera, mesh };
}

/**
 * Renders a PNG thumbnail off screen (§79). Returns null when WebGL is
 * unavailable, so callers treat a thumbnail as optional.
 */
export async function renderThumbnail(
  buffer: ArrayBuffer,
  size = 512,
): Promise<Blob | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const geometry = parseStl(buffer);
    const { renderer, scene, camera, mesh } = buildScene(geometry, size, size, canvas);
    mesh.rotation.z = Math.PI / 8;
    renderer.render(scene, camera);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );

    // WebGL contexts are a scarce resource; a leaked one per upload will
    // eventually stop the app rendering anything at all.
    geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    renderer.dispose();
    return blob;
  } catch {
    return null;
  }
}

/** Interactive preview with drag-to-orbit (§80). */
export function ModelPreview({
  buffer,
  height = 280,
}: {
  buffer: ArrayBuffer;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;

    let frame = 0;
    let parts: SceneParts | null = null;

    try {
      const width = host.clientWidth || 400;
      const geometry = parseStl(buffer);
      if (geometry.getAttribute('position').count === 0) {
        setError('No triangles found in this file.');
        return;
      }

      parts = buildScene(geometry, width, height);
      host.appendChild(parts.renderer.domElement);

      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let velocity = 0.004;

      const onDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        velocity = 0;
        host.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging || !parts) return;
        parts.mesh.rotation.z += (e.clientX - lastX) * 0.01;
        parts.mesh.rotation.x += (e.clientY - lastY) * 0.01;
        lastX = e.clientX;
        lastY = e.clientY;
      };
      const onUp = (e: PointerEvent) => {
        dragging = false;
        host.releasePointerCapture(e.pointerId);
      };

      host.addEventListener('pointerdown', onDown);
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerup', onUp);

      const animate = () => {
        frame = requestAnimationFrame(animate);
        if (!parts) return;
        if (!dragging) parts.mesh.rotation.z += velocity;
        parts.renderer.render(parts.scene, parts.camera);
      };
      animate();

      return () => {
        cancelAnimationFrame(frame);
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerup', onUp);
        if (parts) {
          parts.renderer.domElement.remove();
          parts.mesh.geometry.dispose();
          (parts.mesh.material as THREE.Material).dispose();
          parts.renderer.dispose();
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not render this model.');
      return;
    }
  }, [buffer, height]);

  if (error) {
    return (
      <div
        className="grid place-items-center rounded-lg border border-line bg-ink-950/50 text-xs text-slate-500"
        style={{ height }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={container}
      className="cursor-grab overflow-hidden rounded-lg border border-line bg-ink-950/50 active:cursor-grabbing"
      style={{ height }}
    />
  );
}
