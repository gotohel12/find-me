import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { applyLang, initialLang, translate, type Lang } from './i18n.ts';
import { Splash } from './screens/Splash.tsx';
import { Home } from './screens/Home.tsx';
import { Hide, type HideResult } from './screens/Hide.tsx';
import { Seek } from './screens/Seek.tsx';
import { SeekOnline } from './screens/SeekOnline.tsx';
import { api } from './api.ts';
import { PAINT_SIZE } from '@findme/shared';
import { loadScene, type SceneData } from './game/load.ts';

interface I18n {
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLang: (l: Lang) => void;
}

const I18nCtx = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const v = useContext(I18nCtx);
  if (!v) throw new Error('I18n missing');
  return v;
}

export function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [splashDone, setSplashDone] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [screen, setScreen] = useState<'home' | 'loading' | 'hide' | 'pass' | 'seek' | 'online' | 'missing'>('home');
  const [online2, setOnline2] = useState(false); // server has accounts
  const [live, setLive] = useState<{ code: string } | 'sending' | null>(null);
  const [challenge] = useState(() => new URLSearchParams(location.search).get('c') ?? undefined);
  useEffect(() => {
    api.hasAccounts().then(async (ok) => {
      if (!ok) return;
      try {
        await api.ensurePlayer(lang);
        setOnline2(true);
      } catch {
        /* offline play still works */
      }
    });
  }, []);
  const [scene, setScene] = useState<SceneData | null>(null);
  const [hide, setHide] = useState<HideResult | null>(null);

  const startHide = (sceneId: string) => {
    setScreen('loading');
    const orient = innerHeight > innerWidth ? 'portrait' : 'landscape';
    loadScene(sceneId, orient)
      .then((s) => {
        setScene(s);
        setScreen('hide');
      })
      .catch(() => setScreen('missing'));
  };

  useEffect(() => applyLang(lang), [lang]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const i18n = useMemo<I18n>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);

  return (
    <I18nCtx.Provider value={i18n}>
      {!online && <div class="offline-banner" role="status">{i18n.t('offline')}</div>}
      {!splashDone ? (
        <Splash onDone={() => setSplashDone(true)} />
      ) : screen === 'hide' && scene ? (
        <Hide
          scene={scene}
          onBack={() => setScreen('home')}
          onSubmit={(r) => {
            setHide(r);
            setScreen('pass');
            if (!online2) return;
            setLive('sending');
            const c = document.createElement('canvas');
            c.width = c.height = PAINT_SIZE;
            c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.paint.data), PAINT_SIZE, PAINT_SIZE), 0, 0);
            api
              .submitHide({
                sceneId: r.scene.meta.sceneId,
                orientation: r.scene.base.includes('/portrait/') ? 'portrait' : 'landscape',
                pose: r.sprite.pose,
                angle: r.sprite.angle,
                placement: r.placement,
                paint: c.toDataURL('image/png').split(',')[1],
              })
              .then((x) => setLive({ code: x.code }), () => setLive(null));
          }}
        />
      ) : screen === 'pass' && hide ? (
        <div class="pass">
          <h1>{i18n.t('pass.title')}</h1>
          {live === 'sending' && <p>{i18n.t('hide.sending')}</p>}
          {live && live !== 'sending' && (
            <>
              <p>{i18n.t('pass.live')}</p>
              <p class="code" dir="ltr">{i18n.t('pass.code', { code: live.code })}</p>
            </>
          )}
          <p>{i18n.t('pass.body')}</p>
          <button class="btn-big seek" onClick={() => setScreen('seek')}>
            {i18n.t('pass.local')}
          </button>
          {online2 && (
            <button class="btn" onClick={() => setScreen('online')}>
              {i18n.t('pass.seek')}
            </button>
          )}
          <button class="btn ghost" onClick={() => setScreen('home')}>
            {i18n.t('seek.home')}
          </button>
        </div>
      ) : screen === 'seek' && hide ? (
        <Seek hide={hide} onAgain={() => setScreen('hide')} onHome={() => setScreen('home')} />
      ) : screen === 'online' ? (
        <SeekOnline challenge={challenge} onHome={() => setScreen('home')} onHide={() => setScreen('home')} />
      ) : screen === 'loading' ? (
        <div class="pass" aria-busy="true">
          <div class="spinner" />
          <p>{i18n.t('loading')}</p>
        </div>
      ) : screen === 'missing' ? (
        <div class="pass">
          <p>{i18n.t('assets.missing')}</p>
          <button class="btn" onClick={() => setScreen('home')}>
            {i18n.t('back')}
          </button>
        </div>
      ) : (
        <Home onHide={startHide} onSeek={online2 ? () => setScreen('online') : undefined} />
      )}
    </I18nCtx.Provider>
  );
}
