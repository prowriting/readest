import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const androidIconSource = join(process.cwd(), 'src-tauri/icons/android');

const paddedIconHashes: Record<string, string> = {
  'mipmap-mdpi/ic_launcher.png': '3737696ba178f4d7e40027b2ba410a89c07911e4c34160a83c611799eed4ee7c',
  'mipmap-mdpi/ic_launcher_foreground.png':
    '81dc3cc590ae06ca1b6568662a578934b07a3a5cb9bcf365495d4a00ed54723b',
  'mipmap-mdpi/ic_launcher_monochrome.png':
    '2eb45b4557dd89ebc753ca0348aebc13926bb8f2679ed576f6bffa0b4a83509b',
  'mipmap-hdpi/ic_launcher.png': 'b339c62ecdfb643cfff1075a985b12e974035c4518f3b980b98e2be7bb91f7c2',
  'mipmap-hdpi/ic_launcher_foreground.png':
    'f51c809cc228cdd30a305567239ade95e77896f97da103d80e9141d5673973b6',
  'mipmap-hdpi/ic_launcher_monochrome.png':
    'c40e367aab014c629575debcf9b84b4d9f70cb9a55eae23b38bf8334b547323d',
  'mipmap-xhdpi/ic_launcher.png':
    'a732f071a72fb480a3b8c0a1d5b319cf95ce14144c4ae05fd74283bc34b643e1',
  'mipmap-xhdpi/ic_launcher_foreground.png':
    '21120988a5f59bd071303a664459214c4ea2c78da136bbfb9dccc35362f1c1e7',
  'mipmap-xhdpi/ic_launcher_monochrome.png':
    'df82c6567f56170d988892139b9946cc85b474e817d365433694ad0369bed3e6',
  'mipmap-xxhdpi/ic_launcher.png':
    '38110c653511bf36680fa16f72341683738aaaba8e5887838902fcb0cfa61352',
  'mipmap-xxhdpi/ic_launcher_foreground.png':
    'cded1b6135b5092bc5badf9c5537104b234101a93147c373c04ec3ab330f85e2',
  'mipmap-xxhdpi/ic_launcher_monochrome.png':
    'ed75766def0df525bf659fb80397a48495261488092fc4fcdcbee67f2f4517e4',
  'mipmap-xxxhdpi/ic_launcher.png':
    '60fdde8d22fdd85fba192ffc1738e7cdb58bff141adbe778e2fb133729befe6a',
  'mipmap-xxxhdpi/ic_launcher_foreground.png':
    '7d6cd8c2c946ec13f21e32444b60bb560fa8c00f9c32f8a3b3ae2242053174d6',
  'mipmap-xxxhdpi/ic_launcher_monochrome.png':
    'fa50fe21c63558b8b193b7825715fde473f4465b093696410b76198a7ef16c0f',
};

describe('Android icon assets', () => {
  test('keeps the Android Auto attribution mark inside its safe area', () => {
    const icon = readFileSync(
      join(
        process.cwd(),
        'src-tauri/plugins/tauri-plugin-native-tts/android/src/main/res/drawable/ic_car_attribution.xml',
      ),
      'utf8',
    );

    expect(icon).toContain('android:pivotX="12"');
    expect(icon).toContain('android:pivotY="12"');
    expect(icon).toContain('android:scaleX="0.75"');
    expect(icon).toContain('android:scaleY="0.75"');
  });

  test('keeps the padded launcher artwork at every density', () => {
    for (const [name, expectedHash] of Object.entries(paddedIconHashes)) {
      const icon = readFileSync(join(androidIconSource, name));
      const actualHash = createHash('sha256').update(icon).digest('hex');
      expect(actualHash, name).toBe(expectedHash);

      if (name.endsWith('/ic_launcher.png')) {
        const roundIcon = readFileSync(
          join(androidIconSource, name.replace('ic_launcher.png', 'ic_launcher_round.png')),
        );
        expect(roundIcon, name).toEqual(icon);
      }
    }
  });

  test('uses the padded foreground and monochrome adaptive icon layers', () => {
    const icon = readFileSync(join(androidIconSource, 'mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');

    expect(icon).toContain('<background android:drawable="@color/ic_launcher_background"/>');
    expect(icon).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>');
    expect(icon).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>');
  });
});
