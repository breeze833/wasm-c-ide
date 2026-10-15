/**
 * raylib-wasi Host Bridge TypeScript Definitions
 */

export interface RaylibHostOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas | null;
  gl?: WebGLRenderingContext | null;
  sharedBuffer?: SharedArrayBuffer | null;
  width?: number;
  height?: number;
  dpiScale?: number;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  onFrame?: (bitmap?: ImageBitmap | null) => void;
  onClose?: () => void;
}

export interface RaylibHostInstance {
  input: InputCoordinator;
  gl: WebGLRenderingContext | null;
  getImports(): {
    gl: Record<string, Function>;
    raylib: Record<string, Function>;
    wasi_snapshot_preview1: Record<string, Function>;
  };
  setMemory(mem: WebAssembly.Memory): void;
  setInstance(inst: WebAssembly.Instance): void;
  run(wasmBinary: BufferSource): Promise<WebAssembly.Instance>;
}

export class InputCoordinator {
  constructor(options?: {
    canvas?: HTMLCanvasElement | OffscreenCanvas | null;
    sharedBuffer?: SharedArrayBuffer | null;
    width?: number;
    height?: number;
    dpiScale?: number;
  });
  attachListeners(canvas: HTMLCanvasElement): void;
  updateSharedState(): void;
  pollToWasm(statePtr: number, wasmMemory: WebAssembly.Memory): void;
}

export function createGLImports(
  gl: WebGLRenderingContext,
  getMemory: () => WebAssembly.Memory
): Record<string, Function>;

export function createWasiImports(
  getMemory: () => WebAssembly.Memory,
  options?: { print?: (text: string) => void; printErr?: (text: string) => void }
): Record<string, Function>;

export function createRaylibHost(options?: RaylibHostOptions): RaylibHostInstance;

export default createRaylibHost;
