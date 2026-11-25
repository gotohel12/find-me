import { useEffect, useState } from 'preact/hooks';
import { formatCountdown } from '@findme/shared';
import { useI18n } from '../app.tsx';
import { api, type Player, type Today } from '../api.ts';

export function Home({ onHide, onSeek }: { onHide: (sceneId: string) => void; onSeek?: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [today, setToday] = useState<Today | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState(false);
  const [left, setLeft] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);

  const load = () => {
    setError(false);
    api
      .today()
      .then((d) => {
        setToday(d);
        setLeft(d.nextReleaseInMs);
      })
      .catch(() => setError(true));
    // The guest profile is created once by App; here we only read it (if the server has accounts).
    api.hasAccounts().then((ok) => {
      if (ok && localStorage.getItem('findme.token')) api.me().then(setPlayer, () => setPlayer(null));
    });
  };
  useEffect(load, []);

  useEffect(() => {
    if (!today) return;
    const end = Date.now() + today.nextReleaseInMs;
    const id = setInterval(() => {
      const ms = end - Date.now();
      setLeft(ms);
      if (ms <= 0) load(); // new scene just dropped
    }, 1000);
    return () => clearInterval(id);
  }, [today]);

  const soon = () => {
    setToast(t('home.needs_online'));
    setTimeout(() => setToast(null), 3500);
  };

  const portrait = typeof innerHeight === 'number' && innerHeight > innerWidth;
  const base = today ? (portrait ? today.scene.assets.portrait : today.scene.assets.landscape) : '';

  return (
    <main class="home">
      <header class="topbar">
        <div class="brand">
          <strong>{t('app.name')}</strong>
        </div>
        <div class="chips">
          {player && <span class="chip">🔥 {t('home.streak', { n: player.streakDays ?? 0 })}</span>}
          <button class="chip" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            {lang === 'ar' ? t('lang.en') : t('lang.ar')}
          </button>
        </div>
      </header>

      <section class="today-card" aria-busy={!today && !error}>
        <h2>{t('home.today')}</h2>
        {error ? (
          <div class="state">
            <p>{t('home.error')}</p>
            <button class="btn" onClick={load}>
              {t('home.retry')}
            </button>
          </div>
        ) : !today ? (
          <div class="skeleton" aria-label={t('home.loading')} />
        ) : (
          <>
            {imgOk && (
              <picture>
                <source type="image/avif" srcset={`${base}beauty.avif`} />
                <img
                  class="scene-img"
                  src={`${base}beauty.webp`}
                  alt={today.scene.title[lang]}
                  decoding="async"
                  onError={() => setImgOk(false)}
                />
              </picture>
            )}
            <p class="scene-title">{today.scene.title[lang]}</p>
            <p class="countdown" aria-live="off">
              {t('home.next_in', { time: formatCountdown(left) })}
            </p>
          </>
        )}
      </section>

      <nav class="big-actions">
        <button class="btn-big hide" onClick={() => today && onHide(today.scene.id)} disabled={!today}>
          {t('home.hide')}
        </button>
        <button class="btn-big seek" onClick={onSeek ?? soon} disabled={!today}>
          {t('home.seek')}
        </button>
      </nav>

      <footer class="credit" dir="ltr">
        <b>{t('credit')}</b>
        <small>{t('copyright')}</small>
      </footer>
      {toast && (
        <div class="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
