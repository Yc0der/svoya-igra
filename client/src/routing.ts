export function pageForPath(pathname: string): 'board' | 'player' | 'admin' {
  if (pathname === '/board') return 'board';
  if (pathname === '/admin') return 'admin';
  return 'player';
}
