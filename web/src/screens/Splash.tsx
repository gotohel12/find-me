import { useEffect } from 'preact/hooks';
import { useI18n } from '../app.tsx';

/** "Mohsen ~ Danial" paint-reveal, then the logo. Tap to skip. ~1.8 s. */
export function Splash({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = setTimeout(onDone, reduce ? 400 : 1800);
    return () => clearTimeout(id);
  }, [onDone]);
  return (
    <button class="splash" onClick={onDone} aria-label={t('app.name')}>
      <span class="splash-credit" dir="ltr">
        Mohsen <span class="tilde">~</span> Danial
      </span>
      <span class="splash-logo">
        <span lang="en">FIND ME</span>
        <span lang="ar">لقني</span>
      </span>
    </button>
  );
}
