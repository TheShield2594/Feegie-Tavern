import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

let sharedTexture: CanvasTexture | null = null;
let sharedGeometry: PlaneGeometry | null = null;

function shadowTexture(): CanvasTexture {
  if (sharedTexture) return sharedTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(20, 24, 22, 0.55)');
  gradient.addColorStop(0.55, 'rgba(20, 24, 22, 0.28)');
  gradient.addColorStop(1, 'rgba(20, 24, 22, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  sharedTexture = new CanvasTexture(canvas);
  sharedTexture.colorSpace = SRGBColorSpace;
  return sharedTexture;
}

/**
 * A soft dark disc under a character's feet.
 *
 * Real shadow maps ground a character when the sun is out; at dusk, indoors
 * and under a canopy they thin to nothing and the feet float. This decal is
 * always there, which is the single cheapest thing that makes a figure look
 * like it is standing on the ground rather than pasted over it.
 */
export function makeBlobShadow(radius = 0.5, opacity = 1): Mesh {
  sharedGeometry ??= new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({
    map: shadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    // Sits on the ground plane, so bias it forward rather than fighting it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(sharedGeometry, material);
  mesh.name = 'BlobShadow';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.scale.set(radius * 2, radius * 2, 1);
  mesh.renderOrder = 2;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
