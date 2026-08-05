import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  execSync('pnpm run build', { stdio: 'inherit' });
}
