import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('BookArc app update destinations', () => {
  it('links to the BookArc listings published on bookarc.app/reader-app', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/UpdaterWindow.tsx'), 'utf8');
    expect(source).toContain('https://apps.apple.com/app/id6802607914');
    expect(source).toContain('https://play.google.com/store/apps/details?id=com.bookarc.app');
    expect(source).not.toContain('id6738622779');
  });

  it('sends install fallbacks to the reader download page', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/services/constants.ts'), 'utf8');
    expect(source).toContain("DOWNLOAD_READEST_URL = 'https://bookarc.app/reader-app'");
  });
});
