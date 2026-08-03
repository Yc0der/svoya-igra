export function pageForPath(pathname: string): 'board' | 'player' {
  return pathname === '/board' ? 'board' : 'player';
}
