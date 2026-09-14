declare module "node:fs/promises" {
  export function writeFile(path: string | URL, data: string | Uint8Array, options?: { flag?: string; encoding?: "utf8" | "utf-8" }): Promise<void>;
}

// The workspace's minimal net shim does not carry Writable's inherited API.
declare module "node:tty" {
  interface WriteStream {
    write(chunk: string | Uint8Array): boolean;
  }
}
