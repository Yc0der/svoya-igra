import type { NetworkInterfaceInfo } from 'node:os';

export function pickLanAddress(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): string | null {
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return null;
}
