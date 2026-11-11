/**
 * Filesystem adapter — async file IO.
 *
 * Async-only so hosts with asynchronous filesystem APIs can satisfy the same
 * interface. Node hosts back this with `node:fs/promises`.
 *
 * Universal code never imports `node:fs` directly — it declares an `Fs` in
 * its `Deps` and the host injects the concrete implementation.
 */
export interface Fs {
  /** Read a file as UTF-8 text. Rejects if the path does not exist. */
  readFile(path: string): Promise<string>;

  /** Write UTF-8 text, creating or truncating the file. */
  writeFile(path: string, content: string): Promise<void>;

  /** Resolve `true` if the path exists, `false` otherwise. Never rejects. */
  exists(path: string): Promise<boolean>;

  /** Create a directory, including parents. No-op if it already exists. */
  mkdir(path: string): Promise<void>;

  /** List immediate child names of a directory (not recursive). */
  readdir(path: string): Promise<string[]>;

  /**
   * Remove a file or directory. Recursive for directories. No-op if the
   * path does not exist (idempotent).
   */
  rm(path: string): Promise<void>;
}
