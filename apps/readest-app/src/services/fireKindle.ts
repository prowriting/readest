import type { AppService } from '@/types/system';
import type { DeliveryReceipt } from '@/libs/document';
import { getAPIBaseUrl } from '@/services/environment';

export type KindleSource = {
  id: string;
  title: string;
  format: string;
  delivery?: DeliveryReceipt;
  downloadRef?: string;
  loadOriginal: () => Promise<File | null>;
};

export type FireKindleFile = {
  path: string;
  sourceSha256: string;
  fileSha256: string;
  converterVersion: string;
  exportKey: string;
};
type CachedVariant = Omit<FireKindleFile, 'path'> & { relativePath: string };
const converterVersionPattern = /^calibre-[a-zA-Z0-9.-]{1,50}-hybrid-v[0-9]+$/;
const digestPattern = /^[a-f0-9]{64}$/;
const folder = 'kindle-conversions';
const maxFileBytes = 100 * 1024 * 1024;

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function prepareFireKindleFile(
  app: AppService,
  source: KindleSource,
  signal: AbortSignal,
): Promise<FireKindleFile> {
  signal.throwIfAborted();
  if (source.format.toUpperCase() !== 'EPUB')
    throw new Error('Direct Kindle import requires EPUB.');
  let uploadedBytes: ArrayBuffer | undefined;
  let importedSha: string | undefined;
  if (!source.delivery && !source.downloadRef) {
    // Ordinary/in-place imports can change while retaining a library ID.
    // Identify the actual file before using any previous conversion.
    const file = await source.loadOriginal();
    signal.throwIfAborted();
    if (!file) throw new DOMException('Cancelled', 'AbortError');
    if (file.size > 50 * 1024 * 1024)
      throw new Error('This book is too large to convert. Use Amazon Send to Kindle.');
    uploadedBytes = await file.arrayBuffer();
    importedSha = await sha256(uploadedBytes);
  }
  // Include the receipt in the manifest key: another edition/entitlement must
  // never inherit a previous title's cache. The receipt is not stored in it.
  const identity = source.delivery
    ? `${source.delivery.sourceSha256}:${source.delivery.receipt}`
    : `${source.downloadRef ? 'claim' : 'import'}:${source.downloadRef ?? importedSha}`;
  const manifestPath = `${folder}/${await sha256(new TextEncoder().encode(identity).buffer)}.json`;
  try {
    const cached = JSON.parse(
      (await app.readFile(manifestPath, 'Data', 'text')) as string,
    ) as CachedVariant;
    if (
      converterVersionPattern.test(cached.converterVersion) &&
      digestPattern.test(cached.sourceSha256) &&
      digestPattern.test(cached.fileSha256) &&
      cached.relativePath === `${folder}/${cached.sourceSha256}-${cached.converterVersion}.mobi` &&
      cached.exportKey === `${cached.sourceSha256}-${cached.converterVersion}` &&
      (!source.delivery || cached.sourceSha256 === source.delivery.sourceSha256)
    ) {
      const bytes = await app.readFile(cached.relativePath, 'Data', 'binary');
      if (bytes instanceof ArrayBuffer && (await sha256(bytes)) === cached.fileSha256) {
        signal.throwIfAborted();
        return { ...cached, path: await app.resolveFilePath(cached.relativePath, 'Data') };
      }
    }
  } catch {
    signal.throwIfAborted();
    // Missing, interrupted or damaged caches are rebuilt from the same source.
  }

  const api = getAPIBaseUrl();
  let receipt = source.delivery?.receipt;
  let expectedSource = source.delivery?.sourceSha256 ?? importedSha;
  const getVariant = (token: string) =>
    fetch(`${api}/delivery/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt: token, format: 'mobi' }),
      signal,
    });
  let response: Response;
  if (receipt) response = await getVariant(receipt);
  else if (source.downloadRef) {
    response = await fetch(
      `${api}/claim/download?ref=${encodeURIComponent(source.downloadRef)}&format=mobi`,
      { signal },
    );
  } else {
    // The caller presents the upload explanation before invoking this branch.
    response = await fetch(`${api}/delivery/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/epub+zip' },
      body: uploadedBytes,
      signal,
    });
  }
  const deadline = Date.now() + 3 * 60 * 1000;
  while (true) {
    signal.throwIfAborted();
    if (!response.ok) {
      if ([403, 404, 410, 423].includes(response.status)) {
        throw new Error('This copy is no longer available for Kindle export.');
      }
      throw new Error('Could not prepare the Kindle copy. Please try again.');
    }
    const sourceSha256 = response.headers.get('X-BookArc-Source-SHA256') ?? '';
    const version = response.headers.get('X-BookArc-Converter-Version');
    if (
      !digestPattern.test(sourceSha256) ||
      !version ||
      !converterVersionPattern.test(version) ||
      (expectedSource && expectedSource !== sourceSha256)
    ) {
      throw new Error('The returned copy does not match this book.');
    }
    expectedSource = sourceSha256;
    if (response.status === 202) {
      receipt = response.headers.get('X-BookArc-Delivery-Receipt') ?? receipt;
      if (!receipt || Date.now() >= deadline)
        throw new Error('The Kindle copy is still being prepared. Please try again shortly.');
      const seconds = Number(response.headers.get('Retry-After') ?? '3');
      await response.body?.cancel();
      await pause(
        Math.min(15, Math.max(0.1, Number.isFinite(seconds) ? seconds : 3)) * 1000,
        signal,
      );
      response = await getVariant(receipt);
      continue;
    }
    const fileSha256 = response.headers.get('X-BookArc-File-SHA256') ?? '';
    if (
      response.status !== 200 ||
      !digestPattern.test(fileSha256) ||
      !response.headers.get('Content-Type')?.startsWith('application/x-mobipocket-ebook') ||
      Number(response.headers.get('Content-Length')) > maxFileBytes
    ) {
      throw new Error('Invalid Kindle download. Please try again.');
    }
    const bytes = await response.arrayBuffer();
    if (
      !bytes.byteLength ||
      bytes.byteLength > maxFileBytes ||
      (await sha256(bytes)) !== fileSha256
    ) {
      throw new Error('The Kindle download was incomplete. Please try again.');
    }
    signal.throwIfAborted();
    const relativePath = `${folder}/${sourceSha256}-${version}.mobi`;
    const entry: CachedVariant = {
      relativePath,
      sourceSha256,
      fileSha256,
      converterVersion: version,
      exportKey: `${sourceSha256}-${version}`,
    };
    await app.createDir(folder, 'Data', true);
    await app.writeFile(relativePath, 'Data', bytes);
    signal.throwIfAborted();
    // Publish only complete files. A partial write cannot be reused on retry.
    await app.writeFile(manifestPath, 'Data', JSON.stringify(entry));
    return { ...entry, path: await app.resolveFilePath(relativePath, 'Data') };
  }
}
