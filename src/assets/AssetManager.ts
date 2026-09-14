import type { BufferGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { extractGeometries, geometryStats } from './gltfImport';
import { KITS_BY_ID, MODELS_BY_ID, referencedKits, type KitId, type ModelDef } from './manifest';

/**
 * Loads the optimised kit GLBs and hands out bare geometry.
 *
 * Two decisions worth stating:
 *
 * 1. **Meshopt, not Draco.** three bundles the meshopt decoder as a module, so
 *    compression costs no extra files served from `public/` and no decoder
 *    path to configure. Draco would need its WASM shipped separately for a
 *    similar payload win.
 *
 * 2. **Missing kits are not an error.** The game shipped entirely procedural,
 *    and every system still has that path. A kit that fails to load leaves
 *    `geometry()` returning null, the system keeps its generated mesh, and the
 *    world renders exactly as it did before. This is what allows the art to be
 *    replaced one category at a time, and it means a bad deploy degrades to the
 *    old look instead of a black screen.
 */

export interface LoadReport {
  kit: KitId;
  ok: boolean;
  nodes: number;
  vertices: number;
  triangles: number;
  error?: string;
}

export class AssetManager {
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private geometries = new Map<string, BufferGeometry>();
  /** Raw node names per kit, so `assets:inspect` and dev warnings can list them. */
  private nodesByKit = new Map<KitId, string[]>();
  private reports: LoadReport[] = [];
  private loaded = false;

  private url(file: string): string {
    const base = import.meta.env.BASE_URL ?? '/';
    return `${base.endsWith('/') ? base : `${base}/`}${file}`;
  }

  /**
   * Loads every kit the manifest actually references. Kits are fetched in
   * parallel; a failure is recorded and skipped rather than rejected, so one
   * missing file cannot stop the others.
   */
  async loadAll(onProgress?: (done: number, total: number) => void): Promise<LoadReport[]> {
    const kits = referencedKits();
    let done = 0;
    onProgress?.(0, kits.length);

    this.reports = await Promise.all(
      kits.map(async (id) => {
        const report = await this.loadKit(id);
        done += 1;
        onProgress?.(done, kits.length);
        return report;
      }),
    );

    this.loaded = true;
    return this.reports;
  }

  private async loadKit(id: KitId): Promise<LoadReport> {
    const def = KITS_BY_ID.get(id);
    if (!def) return { kit: id, ok: false, nodes: 0, vertices: 0, triangles: 0, error: 'not in KITS' };

    try {
      const gltf = await this.loader.loadAsync(this.url(def.file));

      // Each model carries its own normalisation, so the manifest's entries
      // must reach the importer. Passing none left every model at the kit's
      // authored size and grounded node-by-node, which drops a canopy to the
      // foot of its own trunk instead of keeping it atop the tree.
      const wanted = new Map<string, ModelDef>();
      for (const model of MODELS_BY_ID.values()) {
        if (model.kit === id) wanted.set(model.node, model);
      }
      const extracted = extractGeometries(gltf.scene, (node) => wanted.get(node)?.normalize ?? {});
      this.nodesByKit.set(id, [...extracted.keys()]);

      let vertices = 0;
      let triangles = 0;

      // Only the nodes the manifest asks for are kept; a 330-model kit should
      // not park 330 geometries in memory to place a dozen trees.
      for (const model of MODELS_BY_ID.values()) {
        if (model.kit !== id) continue;
        const geometry = extracted.get(model.node);
        if (!geometry) continue;
        this.geometries.set(model.id, geometry);
        const stats = geometryStats(geometry);
        vertices += stats.vertices;
        triangles += stats.triangles;
      }

      // Anything extracted but unclaimed is disposed rather than leaked.
      for (const [node, geometry] of extracted) {
        if (![...MODELS_BY_ID.values()].some((m) => m.kit === id && m.node === node)) {
          geometry.dispose();
        }
      }

      return { kit: id, ok: true, nodes: extracted.size, vertices, triangles };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (import.meta.env.DEV) {
        console.warn(`[assets] kit "${id}" unavailable (${message}); using procedural fallback`);
      }
      return { kit: id, ok: false, nodes: 0, vertices: 0, triangles: 0, error: message };
    }
  }

  /** Geometry for a manifest id, or null when the kit is absent. */
  geometry(id: string): BufferGeometry | null {
    return this.geometries.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.geometries.has(id);
  }

  /** True once `loadAll` has settled, whether or not every kit arrived. */
  get ready(): boolean {
    return this.loaded;
  }

  getReports(): readonly LoadReport[] {
    return this.reports;
  }

  /** Node names found in a loaded kit — used when filling in `MODELS`. */
  nodeNames(kit: KitId): readonly string[] {
    return this.nodesByKit.get(kit) ?? [];
  }

  /** Names a manifest entry points at that the GLB did not contain. */
  missingModels(): ModelDef[] {
    if (!this.loaded) return [];
    return [...MODELS_BY_ID.values()].filter(
      (m) => this.nodesByKit.has(m.kit) && !this.geometries.has(m.id),
    );
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    this.nodesByKit.clear();
    this.reports = [];
    this.loaded = false;
  }
}
