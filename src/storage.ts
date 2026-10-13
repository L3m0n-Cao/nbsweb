const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('opennbs-web', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('files'); request.result.createObjectStore('state'); };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
export async function getStored<T>(store: 'files' | 'state', key: string): Promise<T | undefined> {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function putStored(store: 'files' | 'state', key: string, value: unknown) {
  const db = await dbPromise;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export interface FileHandle { name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }
interface DirectoryHandle {
  kind: 'directory';
  values(): AsyncIterable<DirectoryHandle | (FileHandle & { kind: 'file' })>;
  name: string;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (opts: unknown) => Promise<DirectoryHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandle>;
};
// Preserve paths relative to the selected sounds folder, never just basenames.
export async function pickSoundFolder(): Promise<AsyncIterable<{ path: string; file: File }> | null> {
  if ((window as PickerWindow).showDirectoryPicker) {
    let directory: DirectoryHandle;
    try { directory = await (window as PickerWindow).showDirectoryPicker!({ id: 'nbs-sounds', mode: 'read' }); }
    catch (error) { if ((error as Error).name === 'AbortError') return null; throw error; }
    async function* walk(dir: DirectoryHandle, prefix = ''): AsyncGenerator<{ path: string; file: File }> {
      for await (const entry of dir.values()) {
        const path = prefix + entry.name;
        if (entry.kind === 'directory') yield* walk(entry, path + '/');
        else if (/\.(ogg|wav|mp3|flac)$/i.test(path)) yield { path, file: await entry.getFile() };
      }
    }
    return walk(directory);
  }
  const files = await new Promise<File[] | null>(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.webkitdirectory = true;
    input.onchange = () => resolve([...input.files ?? []]); input.oncancel = () => resolve(null); input.click();
  });
  if (!files) return null;
  return (async function* () {
    for (const file of files) {
      const path = file.webkitRelativePath.split('/').slice(1).join('/');
      if (/\.(ogg|wav|mp3|flac)$/i.test(path)) yield { path, file };
    }
  })();
}
export async function pickFiles(accept = '.nbs,.zip,.mid,.midi,.nbp', multiple = false): Promise<{ file: File; handle?: FileHandle }[]> {
  if ((window as PickerWindow).showOpenFilePicker) {
    try {
      const handles = await (window as PickerWindow).showOpenFilePicker!({ multiple, types: [{ description: 'Supported files', accept: { 'application/octet-stream': accept.split(',') } }] });
      return Promise.all(handles.map(async handle => ({ file: await handle.getFile(), handle })));
    } catch (error) { if ((error as Error).name === 'AbortError') return []; throw error; }
  }
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = () => resolve([...input.files ?? []].map(file => ({ file })));
    input.oncancel = () => resolve([]); input.click();
  });
}
export async function saveFile(data: Uint8Array | string, name: string, handle?: FileHandle): Promise<FileHandle | undefined | null> {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: 'application/octet-stream' });
  try {
    // Long offline renders can outlive transient user activation. Downloads remain
    // available then; invoking a native picker would throw a SecurityError.
    if (!handle && (window as PickerWindow).showSaveFilePicker && navigator.userActivation.isActive) handle = await (window as PickerWindow).showSaveFilePicker!({ suggestedName: name });
    if (handle) { const writer = await handle.createWritable(); await writer.write(blob); await writer.close(); return handle; }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    return undefined;
  } catch (error) { if ((error as Error).name === 'AbortError') return null; throw error; }
}
