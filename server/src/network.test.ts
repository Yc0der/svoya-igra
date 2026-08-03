import { describe, expect, it } from 'vitest';
import { pickLanAddress } from './network.js';
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
