import { describe, expect, it } from 'vitest';
import { listLanCandidates, pickLanAddress } from './network.js';
import type { NetworkInterfaceInfo } from 'node:os';

function ipv4(address: string, internal: boolean): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

describe('pickLanAddress', () => {
  it('picks the first non-internal IPv4 address', () => {
    const interfaces = {
      lo: [ipv4('127.0.0.1', true)],
      'Wi-Fi': [ipv4('192.168.1.42', false)],
    };
    expect(pickLanAddress(interfaces)).toBe('192.168.1.42');
  });

  it('skips internal-only interfaces', () => {
    const interfaces = { lo: [ipv4('127.0.0.1', true)] };
    expect(pickLanAddress(interfaces)).toBeNull();
  });

  it('returns null when there are no interfaces at all', () => {
    expect(pickLanAddress({})).toBeNull();
  });
});

describe('listLanCandidates', () => {
  it('lists every non-internal IPv4 address with its interface name', () => {
    // Реальная раскладка машины, на которой идёт разработка: виртуальный
    // адаптер VirtualBox перечисляется раньше настоящего Wi-Fi, поэтому
    // pickLanAddress выбирает недостижимый с телефона адрес.
    const interfaces = {
      'Ethernet 2': [ipv4('192.168.56.1', false)],
      'Беспроводная сеть': [ipv4('192.168.31.179', false)],
      lo: [ipv4('127.0.0.1', true)],
    };

    expect(listLanCandidates(interfaces)).toEqual([
      { address: '192.168.56.1', interfaceName: 'Ethernet 2' },
      { address: '192.168.31.179', interfaceName: 'Беспроводная сеть' },
    ]);
  });

  it('lists several addresses of a single interface', () => {
    const interfaces = {
      'Wi-Fi': [ipv4('192.168.1.42', false), ipv4('10.0.0.7', false)],
    };

    expect(listLanCandidates(interfaces)).toEqual([
      { address: '192.168.1.42', interfaceName: 'Wi-Fi' },
      { address: '10.0.0.7', interfaceName: 'Wi-Fi' },
    ]);
  });

  it('skips internal interfaces', () => {
    expect(listLanCandidates({ lo: [ipv4('127.0.0.1', true)] })).toEqual([]);
  });

  it('returns an empty list when there are no interfaces at all', () => {
    expect(listLanCandidates({})).toEqual([]);
  });
});
