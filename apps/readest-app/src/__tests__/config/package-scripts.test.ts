import { describe, expect, it } from 'vitest';

import packageJson from '../../../package.json';

describe('Rust package scripts', () => {
  it('target the Bookarc Cargo package', () => {
    expect(packageJson.scripts['fmt:check']).toBe('cargo fmt -p Bookarc --check');
    expect(packageJson.scripts['clippy:check']).toBe(
      'cargo clippy -p Bookarc --no-deps -- -D warnings',
    );
  });
});
