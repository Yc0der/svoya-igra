import { describe, expect, it } from 'vitest';
import { pageForPath } from './routing';

describe('pageForPath', () => {
  it('picks board for /board', () => {
    expect(pageForPath('/board')).toBe('board');
  });

  it('picks player for /', () => {
    expect(pageForPath('/')).toBe('player');
  });

  it('picks player for any other unknown path', () => {
    expect(pageForPath('/whatever')).toBe('player');
  });
});
