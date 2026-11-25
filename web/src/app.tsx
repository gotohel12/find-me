import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { applyLang, initialLang, translate, type Lang } from './i18n.ts';
import { Splash } from './screens/Splash.tsx';
import { Menu } from './ui/Menu.tsx';

// The 3D game (Three.js + Rapier) loads only when you start playing, so the menu opens fast.
const GameScreen = lazy(() => import('./ui/GameScreen.tsx').then((m) => ({ default: m.GameScreen })));

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
  const [screen, setScreen] = useState<'menu' | 'practice'>('menu');
  const [online, setOnline] = useState(() => navigator.onLine);

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
      ) : screen === 'practice' ? (
        <Suspense fallback={<div class="loading"><div class="blob" /><p>{i18n.t('game.loading')}</p></div>}>
          <GameScreen mapId="m01_japanese_apartment" onExit={() => setScreen('menu')} />
        </Suspense>
      ) : (
        <Menu onPractice={() => setScreen('practice')} />
      )}
    </I18nCtx.Provider>
  );
}
