/** What the tools hand back. */

export interface AssetFile {
  /** Absolute path of the asset. */
  path: string;
  /** Path of the .json sidecar with its provenance. */
  sidecar?: string;
  /** The model that produced it. */
  model?: string;
  /** The kind of mesh, for a mesh. */
  kind?: string;
  /** The licence the asset ships under. */
  licence?: string;
  /** The seed it was generated with. */
  seed?: number;
  /** How long it is, or how long the run took. */
  seconds?: number;
  /** The parameters sent to the Space. */
  params?: Record<string, unknown>;
}
