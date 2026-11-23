import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../app.tsx';

/** MD Studio first, then the FIND ME / لقني logo with the developer credit. Tap to skip. */
export function Splash({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<0 | 1>(0);
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const a = setTimeout(() => setStep(1), reduce ? 300 : 1400);
    const b = setTimeout(onDone, reduce ? 800 : 3000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [onDone]);
  return (
    <button class="splash" onClick={() => (step === 0 ? setStep(1) : onDone())} aria-label={t('app.name')}>
      {step === 0 ? (
        <span class="splash-studio" dir="ltr">
          <span class="md">MD</span> Studio
        </span>
      ) : (
        <>
          <span class="splash-logo">
            <span lang="en">FIND ME</span>
            <span lang="ar">لقني</span>
          </span>
          <span class="splash-credit" dir="ltr">{t('credit')}</span>
        </>
      )}
      <span class="splash-copy" dir="ltr">{t('copyright')}</span>
    </button>
  );
}
