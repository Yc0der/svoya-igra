import type { NetworkInterfaceInfo } from 'node:os';

export interface LanCandidate {
  address: string;
  interfaceName: string;
}

/**
 * Все внешние (non-internal) IPv4-адреса машины вместе с именем интерфейса.
 *
 * Нужен потому, что `pickLanAddress` берёт первый попавшийся адрес в порядке
 * перечисления ключей `os.networkInterfaces()`, а он ничего не знает о том,
 * какая сеть на самом деле та, в которой сидят телефоны: виртуальные адаптеры
 * (VirtualBox, WSL, Hyper-V) выдают вполне валидные non-internal IPv4 и легко
 * оказываются первыми. Ошибка при этом молчаливая — табло показывает QR,
 * который просто никуда не ведёт. Логируя все кандидаты при старте, человек
 * видит, что выбрано и что ещё было, и может переопределить через `LAN_HOST`.
 */
export function listLanCandidates(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): LanCandidate[] {
  const candidates: LanCandidate[] = [];
  for (const [interfaceName, infos] of Object.entries(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal) {
        candidates.push({ address: info.address, interfaceName });
      }
    }
  }
  return candidates;
}

export function pickLanAddress(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): string | null {
  return listLanCandidates(interfaces)[0]?.address ?? null;
}
