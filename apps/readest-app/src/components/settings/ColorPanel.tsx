import React, { useState, useEffect } from 'react';
import {
  applyCustomTheme,
  CustomTheme,
  generateDarkPalette,
  generateLightPalette,
  Theme,
  themes,
} from '@/styles/themes';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import { saveViewSettings } from '@/helpers/settings';
import { manageSyntaxHighlighting } from '@/utils/highlightjs';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { useFileSelector } from '@/hooks/useFileSelector';
import { PREDEFINED_TEXTURES } from '@/styles/textures';
import { useAtmosphereStore } from '@/store/atmosphereStore';
import clsx from 'clsx';
import { BoxedList, SettingLabel } from './primitives';
import NumberInput from './NumberInput';
import ThemeEditor from './color/ThemeEditor';
import ThemeModeSelector from './color/ThemeModeSelector';
import ThemeColorSelector from './color/ThemeColorSelector';
import BackgroundTextureSelector from './color/BackgroundTextureSelector';
import CodeHighlightingSettings from './color/CodeHighlightingSettings';
import ReadingRulerSettings from './color/ReadingRulerSettings';

const ColorPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor, saveCustomTheme } =
    useThemeStore();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const { getView, getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings.invertImgColorInDark,
  );
  const [editTheme, setEditTheme] = useState<CustomTheme | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [showCustomThemeEditor, setShowCustomThemeEditor] = useState(false);
  const [overrideColor, setOverrideColor] = useState(viewSettings.overrideColor);
  const [codeHighlighting, setcodeHighlighting] = useState(viewSettings.codeHighlighting);
  const [codeLanguage, setCodeLanguage] = useState(viewSettings.codeLanguage);
  const [selectedTextureId, setSelectedTextureId] = useState(viewSettings.backgroundTextureId);
  const [backgroundOpacity, setBackgroundOpacity] = useState(viewSettings.backgroundOpacity);
  const [backgroundSize, setBackgroundSize] = useState(viewSettings.backgroundSize);
  const [highlightOpacity, setHighlightOpacity] = useState(viewSettings.highlightOpacity ?? 0.3);

  const [readingRulerEnabled, setReadingRulerEnabled] = useState(viewSettings.readingRulerEnabled);
  const [readingRulerLines, setReadingRulerLines] = useState(viewSettings.readingRulerLines);
  const [readingRulerOpacity, setReadingRulerOpacity] = useState(viewSettings.readingRulerOpacity);
  const [readingRulerColor, setReadingRulerColor] = useState(viewSettings.readingRulerColor);

  const {
    textures: customTextures,
    addTexture,
    loadTexture,
    applyTexture,
    removeTexture,
    loadCustomTextures,
    saveCustomTextures,
  } = useCustomTextureStore();
  const resetToDefaults = useResetViewSettings();
  const { selectFiles } = useFileSelector(appService, _);
  const { activate: activateAtmosphere, deactivate: deactivateAtmosphere } = useAtmosphereStore();

  const handleReset = () => {
    resetToDefaults({
      overrideColor: setOverrideColor,
      invertImgColorInDark: setInvertImgColorInDark,
      highlightOpacity: setHighlightOpacity,
      codeHighlighting: setcodeHighlighting,
      codeLanguage: setCodeLanguage,
      readingRulerEnabled: setReadingRulerEnabled,
      readingRulerLines: setReadingRulerLines,
      readingRulerOpacity: setReadingRulerOpacity,
    });
    setThemeColor('default');
    setThemeMode('auto');
    setSelectedTextureId('none');
    setBackgroundOpacity(0.6);
    setBackgroundSize('cover');
    deactivateAtmosphere();
  };

  const handleTextureSelect = (id: string) => {
    setSelectedTextureId(id);
    const isAnimated = PREDEFINED_TEXTURES.some((t) => t.id === id && t.animated);
    if (isAnimated) {
      activateAtmosphere();
    } else {
      deactivateAtmosphere();
    }
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCustomTextures(envConfig);
  }, [loadCustomTextures, envConfig]);

  useEffect(() => {
    if (invertImgColorInDark === viewSettings.invertImgColorInDark) return;
    saveViewSettings(envConfig, bookKey, 'invertImgColorInDark', invertImgColorInDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertImgColorInDark]);

  useEffect(() => {
    if (overrideColor === viewSettings.overrideColor) return;
    saveViewSettings(envConfig, bookKey, 'overrideColor', overrideColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideColor]);

  useEffect(() => {
    if (highlightOpacity === viewSettings.highlightOpacity) return;
    saveViewSettings(envConfig, bookKey, 'highlightOpacity', highlightOpacity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightOpacity]);

  useEffect(() => {
    let update = false;
    if (codeHighlighting !== viewSettings.codeHighlighting) {
      saveViewSettings(envConfig, bookKey, 'codeHighlighting', codeHighlighting);
      update = true;
    }
    if (codeLanguage !== viewSettings.codeLanguage) {
      saveViewSettings(envConfig, bookKey, 'codeLanguage', codeLanguage);
      update = true;
    }
    if (!update) return;
    const view = getView(bookKey);
    if (!view) return;
    const docs = view.renderer.getContents();
    docs.forEach(({ doc }) => manageSyntaxHighlighting(doc, viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeHighlighting, codeLanguage]);

  useEffect(() => {
    if (selectedTextureId === viewSettings.backgroundTextureId) return;
    saveViewSettings(envConfig, bookKey, 'backgroundTextureId', selectedTextureId);
    applyBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTextureId]);

  useEffect(() => {
    if (backgroundOpacity === viewSettings.backgroundOpacity) return;
    saveViewSettings(envConfig, bookKey, 'backgroundOpacity', backgroundOpacity);
    applyBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundOpacity]);

  useEffect(() => {
    if (backgroundSize === viewSettings.backgroundSize) return;
    saveViewSettings(envConfig, bookKey, 'backgroundSize', backgroundSize);
    applyBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundSize]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'readingRulerEnabled', readingRulerEnabled, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerEnabled]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'readingRulerLines', readingRulerLines, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerLines]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'readingRulerOpacity', readingRulerOpacity, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerOpacity]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'readingRulerColor', readingRulerColor, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerColor]);

  const applyBackgroundTexture = () => {
    applyTexture(envConfig, selectedTextureId);
    document.documentElement.style.setProperty('--bg-texture-opacity', `${backgroundOpacity}`);
    document.documentElement.style.setProperty('--bg-texture-size', backgroundSize);
  };

  useEffect(() => {
    const customThemes = settings.globalReadSettings.customThemes ?? [];
    setCustomThemes(
      customThemes.map((customTheme) => ({
        name: customTheme.name,
        label: customTheme.label,
        colors: {
          light: generateLightPalette(customTheme.colors.light),
          dark: generateDarkPalette(customTheme.colors.dark),
        },
        isCustomizale: true,
      })),
    );
  }, [settings]);

  const handleSaveCustomTheme = (customTheme: CustomTheme) => {
    applyCustomTheme(customTheme);
    saveCustomTheme(envConfig, settings, customTheme);
    setSettings({ ...settings });
    setThemeColor(customTheme.name);
    setShowCustomThemeEditor(false);
  };

  const handleDeleteCustomTheme = (customTheme: CustomTheme) => {
    saveCustomTheme(envConfig, settings, customTheme, true);
    setSettings({ ...settings });
    setThemeColor('default');
    setShowCustomThemeEditor(false);
  };

  const handleEditTheme = (name: string) => {
    const customTheme = settings.globalReadSettings.customThemes.find((t) => t.name === name);
    if (customTheme) {
      setEditTheme(customTheme);
      setShowCustomThemeEditor(true);
    }
  };

  const handleImportImage = () => {
    selectFiles({ type: 'images', multiple: true }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      for (const selectedFile of result.files) {
        const textureInfo = await appService?.importImage(selectedFile.path || selectedFile.file);
        if (!textureInfo) continue;

        const customTexture = addTexture(textureInfo.path, {
          name: textureInfo.name,
          contentId: textureInfo.contentId,
          bundleDir: textureInfo.bundleDir,
          byteSize: textureInfo.byteSize,
        });
        if (customTexture && !customTexture.error) {
          await loadTexture(envConfig, customTexture.id);
          if (appService) void queueReplicaBinaryUpload('texture', customTexture, appService);
        }
      }
      saveCustomTextures(envConfig);
    });
  };

  const handleDeleteCustomTexture = (textureId: string) => {
    removeTexture(textureId);
    const updatedTextures = customTextures.filter((t) => t.id !== textureId);

    settings.customTextures = updatedTextures;
    setSettings(settings);

    if (selectedTextureId === textureId) {
      setSelectedTextureId('none');
    }
    saveCustomTextures(envConfig);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      {showCustomThemeEditor ? (
        <ThemeEditor
          customTheme={editTheme}
          onSave={handleSaveCustomTheme}
          onDelete={handleDeleteCustomTheme}
          onCancel={() => setShowCustomThemeEditor(false)}
        />
      ) : (
        <>
          <ThemeModeSelector
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
            data-setting-id='settings.color.themeMode'
          />

          <label
            data-setting-id='settings.color.invertImageInDarkMode'
            className={clsx(
              'flex items-center justify-between px-4',
              !isDarkMode && 'cursor-not-allowed opacity-50',
              isDarkMode && 'cursor-pointer',
            )}
          >
            <SettingLabel>{_('Invert Image In Dark Mode')}</SettingLabel>
            <input
              type='checkbox'
              className='toggle'
              checked={invertImgColorInDark}
              disabled={!isDarkMode}
              onChange={() => setInvertImgColorInDark(!invertImgColorInDark)}
            />
          </label>

          <label
            data-setting-id='settings.color.overrideBookColor'
            className='flex cursor-pointer items-center justify-between px-4'
          >
            <SettingLabel>{_('Override Book Color')}</SettingLabel>
            <input
              type='checkbox'
              className='toggle'
              checked={overrideColor}
              onChange={() => setOverrideColor(!overrideColor)}
            />
          </label>

          <ThemeColorSelector
            themes={themes.concat(customThemes)}
            themeColor={themeColor}
            isDarkMode={isDarkMode}
            onThemeColorChange={setThemeColor}
            onEditTheme={handleEditTheme}
            onCreateTheme={() => setShowCustomThemeEditor(true)}
            data-setting-id='settings.color.themeColor'
          />

          <BackgroundTextureSelector
            predefinedTextures={PREDEFINED_TEXTURES}
            customTextures={customTextures.filter((t) => !t.deletedAt)}
            selectedTextureId={selectedTextureId}
            backgroundOpacity={backgroundOpacity}
            backgroundSize={backgroundSize}
            onTextureSelect={handleTextureSelect}
            onOpacityChange={setBackgroundOpacity}
            onSizeChange={setBackgroundSize}
            onImportImage={handleImportImage}
            onDeleteTexture={handleDeleteCustomTexture}
            data-setting-id='settings.color.backgroundTexture'
          />

          <BoxedList title={_('Highlights')} data-setting-id='settings.color.highlightColors'>
            <NumberInput
              label={_('Opacity')}
              value={highlightOpacity}
              onChange={setHighlightOpacity}
              disabled={viewSettings.isEink}
              min={0.1}
              max={1}
              step={0.1}
            />
          </BoxedList>

          <ReadingRulerSettings
            enabled={readingRulerEnabled}
            lines={readingRulerLines}
            opacity={readingRulerOpacity}
            color={readingRulerColor}
            onEnabledChange={setReadingRulerEnabled}
            onLinesChange={setReadingRulerLines}
            onOpacityChange={setReadingRulerOpacity}
            onColorChange={setReadingRulerColor}
            data-setting-id='settings.color.readingRuler'
          />

          <CodeHighlightingSettings
            codeHighlighting={codeHighlighting}
            codeLanguage={codeLanguage}
            onToggle={setcodeHighlighting}
            onLanguageChange={setCodeLanguage}
            data-setting-id='settings.color.codeHighlighting'
          />
        </>
      )}
    </div>
  );
};

export default ColorPanel;
