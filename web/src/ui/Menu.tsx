import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../app.tsx';
import { Icon } from './icons.tsx';
import { SettingsModal } from './Settings.tsx';

export function Menu({ onPractice }: { onPractice: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [panel, setPanel] = useState<'none' | 'settings' | 'credits' | 'soon'>('none');
  return (
    <main class="menu">
      <div class="menu-bg" />
      <div class="menu-shade" />
      <div class="menu-inner">
        <h1 class="title">
          <span lang="en">FIND ME</span>
          <span lang="ar">لقني</span>
        </h1>
        <p class="tagline">{t('app.tagline')}</p>
        <nav class="menu-btns">
          <button class="btn primary lg" onClick={onPractice}>
            <Icon.practice size={26} />
            {t('menu.practice')}
          </button>
          <button class="btn accent lg" onClick={() => setPanel('soon')}>
            <Icon.play size={26} />
            {t('menu.play')}
          </button>
          <div class="row">
            <button class="btn ghost" onClick={() => setPanel('settings')}>
              <Icon.gear size={20} />
              {t('menu.settings')}
            </button>
            <button class="btn ghost" onClick={() => setPanel('credits')}>
              <Icon.info size={20} />
              {t('menu.credits')}
            </button>
          </div>
          <button class="btn ghost" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} lang={lang === 'ar' ? 'en' : 'ar'}>
            <Icon.globe size={20} />
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
        </nav>
      </div>
      <footer class="menu-foot">
        <b>Developed by Mohsen ~ Danial</b>
        <span>© 2026 MD Studio. All rights reserved.</span>
      </footer>

      {panel === 'settings' && <SettingsModal onClose={() => setPanel('none')} />}
      {(panel === 'soon' || panel === 'credits') && (
        <div class="scrim" onClick={() => setPanel('none')}>
          <div class="modal glass" onClick={(e) => e.stopPropagation()} role="dialog">
            <div class="modal-head">
              <h2>{panel === 'soon' ? t('menu.play') : t('menu.credits')}</h2>
              <button class="icon-btn" onClick={() => setPanel('none')} aria-label={t('tool3.done')}><Icon.close /></button>
            </div>
            {panel === 'soon' ? <p>{t('menu.online_soon')}</p> : <Credits />}
          </div>
        </div>
      )}
    </main>
  );
}

function Credits() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<{ name: string; license: string; url: string; source?: string }[]>([]);
  useEffect(() => {
    fetch('/assets/3d/maps/m01_japanese_apartment/credits.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Record<string, { name: string; license: string; url: string; source?: string }>) => setAssets(Object.values(d)))
      .catch(() => {});
  }, []);
  return (
    <div class="credits">
      <p class="big">Developed by Mohsen ~ Danial</p>
      <p dir="ltr">© 2026 MD Studio. All rights reserved.</p>
      <p class="section-title">{t('credits.assets')}</p>
      <ul>
        {assets.map((a) => (
          <li key={a.url}>
            <a href={a.url} target="_blank" rel="noopener">{a.name}</a> — {a.source ?? 'Poly Haven'}, {a.license}
          </li>
        ))}
      </ul>
      <p class="paint-hint" dir="ltr">Fonts: Cairo, Baloo Bhaijaan 2 (SIL OFL). Three.js (MIT), Rapier (Apache-2.0), Preact (MIT), Blender (GPL, art pipeline only).</p>
    </div>
  );
}
