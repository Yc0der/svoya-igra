import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Board } from './Board';
import { Player } from './Player';
import { Admin } from './Admin';
import { pageForPath } from './routing';

const route = pageForPath(window.location.pathname);
const page =
  route === 'board' ? <Board /> : route === 'admin' ? <Admin /> : <Player />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{page}</StrictMode>,
);
