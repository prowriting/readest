import type { Page } from '@playwright/test';

/** Seed the saved preference left by a previously signed-in reader. */
export async function rememberCloudLogin(page: Page, disableSync = false): Promise<void> {
  await page.evaluate(async (disableSync) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AppFileSystem', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('files', 'readwrite');
        const store = transaction.objectStore('files');
        const request = store.get('Settings/settings.json');
        request.onsuccess = () => {
          const record = request.result as { path: string; content: string } | undefined;
          if (!record) {
            reject(new Error('The initialized reader settings were not saved.'));
            return;
          }
          const settings: Record<string, unknown> = JSON.parse(record.content);
          if (disableSync) settings.syncCategories = { book: false, progress: false, note: false };
          store.put({ ...record, content: JSON.stringify({ ...settings, keepLogin: true }) });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, disableSync);
}
