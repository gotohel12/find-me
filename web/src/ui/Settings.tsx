import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../app.tsx';
import { settings, type Settings as S } from '../core/settings.ts';
import { QUALITY, pickQuality, type Quality } from '../render/engine.ts';
import { Icon } from './icons.tsx';

type Tab = 'graphics' | 'controls' | 'audio' | 'language' | 'access';

function Slider({ label, k, min, max, step, fmt }: { label: string; k: keyof S; min: number; max: number; step: number; fmt?: (v: number) => string }) {
  const [v, setV] = useState(settings.get()[k] as number);
  return (
    <label class="field">
      <span class="field-row">
        {label}
        <output>{fmt ? fmt(v) : v.toFixed(2)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onInput={(e) => {
          const n = +(e.target as HTMLInputElement).value;
          setV(n);
          settings.set({ [k]: n } as Partial<S>);
        }}
      />
    </label>
  );
}

function Toggle({ label, k }: { label: string; k: keyof S }) {
  const [v, setV] = useState(settings.get()[k] as boolean);
  return (
    <label class="setting inline">
      {label}
      <span class="switch">
        <input
          type="checkbox"
          checked={v}
          onChange={(e) => {
            const n = (e.target as HTMLInputElement).checked;
            setV(n);
            settings.set({ [k]: n } as Partial<S>);
          }}
        />
        <span />
      </span>
    </label>
  );
}

/** Settings live-apply while you play (the game subscribes to the store). */
export function SettingsModal({ onClose, onQuality }: { onClose: () => void; onQuality?: (q: Quality) => void }) {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>('controls');
  const [q, setQ] = useState<Quality>(pickQuality());
  const [, force] = useState(0);
  useEffect(() => settings.subscribe(() => force((n) => n + 1)), []);
  const st = settings.get();
  return (
    <div class="scrim" onClick={onClose}>
      <div class="modal glass" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('menu.settings')}>
        <div class="modal-head">
          <h2>{t('menu.settings')}</h2>
          <button class="icon-btn" onClick={onClose} aria-label={t('tool3.done')}><Icon.close /></button>
        </div>
        <div class="tabs" role="tablist">
          {(['controls', 'graphics', 'audio', 'language', 'access'] as Tab[]).map((x) => (
            <button key={x} class={tab === x ? 'on' : ''} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>
              {t(`settings.tab.${x}`)}
            </button>
          ))}
        </div>
        <div class="settings-grid">
          {tab === 'controls' && (
            <>
              <p class="section-title">{t('settings.pc')}</p>
              <Slider label={t('settings.mouse')} k="mouseSens" min={0.05} max={5} step={0.05} />
              <Slider label={t('settings.mouseX')} k="mouseX" min={0.2} max={2} step={0.05} />
              <Slider label={t('settings.mouseY')} k="mouseY" min={0.2} max={2} step={0.05} />
              <Toggle label={t('settings.invertY')} k="invertY" />
              <p class="section-title">{t('settings.phone')}</p>
              <Slider label={t('settings.touch')} k="touchSens" min={0.05} max={5} step={0.05} />
              <Slider label={t('settings.touchX')} k="touchX" min={0.2} max={2} step={0.05} />
              <Slider label={t('settings.touchY')} k="touchY" min={0.2} max={2} step={0.05} />
              <Slider label={t('settings.joySize')} k="joystickSize" min={90} max={180} step={5} fmt={(v) => `${v}px`} />
              <Slider label={t('settings.deadZone')} k="deadZone" min={0} max={0.4} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} />
              <p class="section-title">{t('settings.paint')}</p>
              <Slider label={t('settings.paintOrbit')} k="paintOrbitSens" min={0.1} max={3} step={0.05} />
              <Slider label={t('settings.paintZoom')} k="paintZoomSpeed" min={0.2} max={3} step={0.05} />
              <p class="section-title">{t('settings.gamepad')}</p>
              <Slider label={t('settings.padSens')} k="padSens" min={0.1} max={3} step={0.05} />
              <label class="setting inline">
                {t('settings.padCurve')}
                <select value={st.padCurve} onChange={(e) => settings.set({ padCurve: (e.target as HTMLSelectElement).value as S['padCurve'] })}>
                  <option value="linear">{t('settings.linear')}</option>
                  <option value="exponential">{t('settings.exponential')}</option>
                </select>
              </label>
              <p class="section-title">{t('settings.camera')}</p>
              <Slider label={t('settings.fov')} k="fov" min={55} max={100} step={1} fmt={(v) => `${v}°`} />
              <Slider label={t('settings.camDist')} k="cameraDistance" min={1.4} max={5} step={0.1} fmt={(v) => `${v.toFixed(1)} m`} />
              <Toggle label={t('settings.camSmooth')} k="cameraSmoothing" />
              <button class="btn ghost" onClick={() => settings.reset()}>{t('settings.reset')}</button>
            </>
          )}
          {tab === 'graphics' && (
            <>
              <label class="setting inline">
                {t('settings.quality')}
                <select
                  value={q}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value as Quality;
                    setQ(v);
                    try {
                      localStorage.setItem('findme.quality', v);
                    } catch {
                      /* ignore */
                    }
                    onQuality?.(v);
                  }}
                >
                  {(Object.keys(QUALITY) as Quality[]).map((k) => (
                    <option key={k} value={k}>{t(`quality.${k}`)}</option>
                  ))}
                </select>
              </label>
              <Toggle label={t('settings.showFps')} k="showFps" />
            </>
          )}
          {tab === 'audio' && (
            <>
              <Slider label={t('settings.master')} k="masterVolume" min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label={t('settings.sfx')} k="sfxVolume" min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label={t('settings.music')} k="musicVolume" min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
            </>
          )}
          {tab === 'language' && (
            <label class="setting inline">
              {t('settings.language')}
              <select value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value as 'ar' | 'en')}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </label>
          )}
          {tab === 'access' && <Toggle label={t('settings.reduceMotion')} k="reduceMotion" />}
        </div>
      </div>
    </div>
  );
}
