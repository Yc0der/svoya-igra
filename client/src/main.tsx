import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Board } from './Board';
import { Player } from './Player';
import { pageForPath } from './routing';

const page =
  pageForPath(window.location.pathname) === 'board' ? <Board /> : <Player />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{page}</StrictMode>,
);
