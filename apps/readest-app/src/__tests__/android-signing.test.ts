// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('Android release store selection', () => {
  it.each([
    false,
    true,
  ])('respects the requested store even with existing signing: %s', (signed) => {
    const dir = mkdtempSync(join(tmpdir(), 'bookarc-signing-'));
    try {
      const app = join(dir, 'src-tauri/gen/android/app');
      mkdirSync(app, { recursive: true });
      const file = join(app, 'build.gradle.kts');
      writeFileSync(
        file,
        `${signed ? '// keystore.properties already configured\n' : '\n'}android {\n    defaultConfig {\n        missingDimensionStrategy("store", "foss")\n    }\n    buildTypes {\n        getByName("release") {\n        }\n    }\n}\n`,
      );
      const key = join(dir, 'test.jks');
      writeFileSync(key, 'test fixture');
      const run = () =>
        execFileSync(process.execPath, [resolve('scripts/setup-android-signing.mjs')], {
          cwd: dir,
          env: {
            ...process.env,
            ANDROID_KEY_ALIAS: 'test',
            ANDROID_KEY_PASSWORD: 'fixture',
            ANDROID_KEYSTORE_FILE: key,
          },
        });
      run();
      const first = readFileSync(file, 'utf8');
      expect(first).toContain(
        'missingDimensionStrategy("store", providers.gradleProperty("storeFlavor").getOrElse("foss"))',
      );
      run();
      expect(readFileSync(file, 'utf8')).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
