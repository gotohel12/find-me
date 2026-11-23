import { render } from 'preact';
import { App } from './app.tsx';
import './styles.css';

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* in-app browsers may block service workers: the game still works */
    });
  });
}
