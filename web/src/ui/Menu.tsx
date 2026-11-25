import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../app.tsx';
import { QUALITY, pickQuality, type Quality } from '../render/engine.ts';

export function Menu({ onPractice }: { onPractice: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [panel, setPanel] = useState<'none' | 'settings' | 'credits' | 'soon'>('none');
  return (
    <main class="menu">
      <div class="menu-bg" />
      <div class="menu-inner">
        <h1 class="title">
          <span lang="en">FIND ME</span>
          <span lang="ar">لقني</span>
        </h1>
        <p class="tagline">{t('app.tagline')}</p>
        <nav class="menu-btns">
          <button class="btn-big hide" onClick={onPractice}>{t('menu.practice')}</button>
          <button class="btn-big seek" onClick={() => setPanel('soon')}>{t('menu.play')}</button>
          <button class="btn" onClick={() => setPanel('settings')}>{t('menu.settings')}</button>
          <button class="btn ghost" onClick={() => setPanel('credits')}>{t('menu.credits')}</button>
        </nav>
        <footer class="credit" dir="ltr">
          <b>{t('credit')}</b>
          <small>{t('copyright')}</small>
        </footer>
      </div>

      {panel !== 'none' && (
        <div class="sheet" onClick={() => setPanel('none')}>
          <div class="panel" onClick={(e) => e.stopPropagation()}>
            {panel === 'soon' && <p>{t('menu.online_soon')}</p>}
            {panel === 'settings' && <Settings lang={lang} setLang={setLang} />}
            {panel === 'credits' && <Credits />}
            <button class="btn" onClick={() => setPanel('none')}>{t('tool3.done')}</button>
          </div>
        </div>
      )}
    </main>
  );
}

function Settings({ lang, setLang }: { lang: string; setLang: (l: 'ar' | 'en') => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState<Quality>(pickQuality());
  return (
    <div class="settings">
      <h2>{t('menu.settings')}</h2>
      <label>
        {t('settings.language')}
        <select value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value as 'ar' | 'en')}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
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
          }}
        >
          {(Object.keys(QUALITY) as Quality[]).map((k) => (
            <option key={k} value={k}>{t(`quality.${k}`)}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Credits() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<{ name: string; license: string; url: string }[]>([]);
  useEffect(() => {
    fetch('/assets/3d/maps/m01_japanese_apartment/credits.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Record<string, { name: string; license: string; url: string }>) => setAssets(Object.values(d)))
      .catch(() => {});
  }, []);
  return (
    <div class="credits">
      <h2>{t('menu.credits')}</h2>
      <p class="big" dir="ltr">Developed by Mohsen ~ Danial</p>
      <p dir="ltr">© 2026 MD Studio. All rights reserved.</p>
      <h3>{t('credits.assets')}</h3>
      <ul dir="ltr">
        {assets.map((a) => (
          <li key={a.url}>
            <a href={a.url} target="_blank" rel="noopener">{a.name}</a> — Poly Haven, {a.license}
          </li>
        ))}
      </ul>
      <p class="small" dir="ltr">Three.js (MIT), Rapier (Apache-2.0), Preact (MIT), Blender (GPL, art pipeline only).</p>
    </div>
  );
}
