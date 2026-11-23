// On Render the dashboard build command may be just `npm install`, so build the
// web app here when running on Render. Locally this does nothing.
import { execSync } from 'node:child_process';
if (process.env.RENDER && !process.env.FINDME_SKIP_BUILD) {
  execSync('npm run build -w @findme/web', { stdio: 'inherit' });
}
