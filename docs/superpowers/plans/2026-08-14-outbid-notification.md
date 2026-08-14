# Уведомление о перебитой ставке — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать персональный тост тому, чью ставку в аукционе только что перебили —
чисто клиентское UX-дополнение поверх уже сыгранной вехи 5.

**Architecture:** `Player.tsx` сравнивает предыдущее и текущее значение
`game.auctionHighestBidderParticipantId` через `useRef` + `useEffect`; переход «было моё
`selfId` → стало чужое» включает локальный тост-стейт с автогашением через `setTimeout`
(тот же двухшаговый паттерн, что уже используется для `falsestart` в `useRoomConnection.ts`,
только целиком на клиенте — новых серверных сообщений не нужно).

**Tech Stack:** React/TypeScript (без изменений в стеке), тот же, что и у остального клиента.

## Global Constraints

- Никаких изменений на сервере (`server/src/*`) — задача целиком в `client/src/Player.tsx` и
  `client/src/index.css`.
- Уведомление показывается **только тому, кого перебили**, никому больше.
- Автогашение через **4 секунды**, без действия пользователя.
- Текст: **«Вашу ставку перебили — {имя нового лидера} поставил {сумма}»**.
- Таймер хода в торгах (`AUCTION_BID_TIMER_MS`) не меняется — перебитый получает те же полные
  20 секунд на свой следующий ход, что и любой другой, доработок не требует.

---

### Task 1: Тост «вашу ставку перебили» в `Player.tsx`

**Files:**

- Modify: `client/src/Player.tsx`
- Modify: `client/src/Player.test.tsx`
- Modify: `client/src/index.css`

**Interfaces:**

- Consumes: `game.auctionHighestBidderParticipantId`, `game.auctionHighestBid`,
  `game.phase`, `selfId` — все уже существуют в `GameStateView`/`RoomConnection`
  (`client/src/useRoomConnection.ts`), ничего нового не добавляется.
- Produces: ничего наружу — локальный UI-эффект, конец цепочки.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `client/src/Player.test.tsx`, новый `describe`-блок в конец файла:

```ts
describe('Player — уведомление о перебитой ставке', () => {
  it('shows a toast when my bid gets outbid during auction-bidding', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'me',
          auctionHighestBid: 150,
          auctionTurnParticipantId: 'other',
        }),
      }),
    );
    const { rerender } = render(<Player />);
    expect(
      screen.queryByText(/вашу ставку перебили/i),
    ).not.toBeInTheDocument();

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [
          { id: 'me', name: 'Я', connected: true },
          { id: 'other', name: 'Соперник', connected: true },
        ],
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'other',
          auctionHighestBid: 300,
          auctionTurnParticipantId: 'me',
        }),
      }),
    );
    rerender(<Player />);
    expect(
      screen.getByText(/вашу ставку перебили — соперник поставил 300/i),
    ).toBeInTheDocument();
  });

  it('hides the toast automatically after 4 seconds', () => {
    vi.useFakeTimers();
    try {
      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'me',
          game: baseGame({
            phase: 'auction-bidding',
            auctionHighestBidderParticipantId: 'me',
            auctionHighestBid: 150,
          }),
        }),
      );
      const { rerender } = render(<Player />);

      mockedUseRoomConnection.mockReturnValue(
        connection({
          selfId: 'me',
          participants: [{ id: 'other', name: 'Соперник', connected: true }],
          game: baseGame({
            phase: 'auction-bidding',
            auctionHighestBidderParticipantId: 'other',
            auctionHighestBid: 300,
          }),
        }),
      );
      rerender(<Player />);
      expect(screen.getByText(/вашу ставку перебили/i)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(4000));
      expect(
        screen.queryByText(/вашу ставку перебили/i),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show the toast for the very first bid in the auction (transition from no bidder)', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: null,
        }),
      }),
    );
    const { rerender } = render(<Player />);

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [{ id: 'other', name: 'Соперник', connected: true }],
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'other',
          auctionHighestBid: 100,
        }),
      }),
    );
    rerender(<Player />);
    expect(
      screen.queryByText(/вашу ставку перебили/i),
    ).not.toBeInTheDocument();
  });

  it('does not show the toast when I was not the previous leader (watching two others bid)', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'a',
          auctionHighestBid: 100,
        }),
      }),
    );
    const { rerender } = render(<Player />);

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        participants: [{ id: 'b', name: 'Б', connected: true }],
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'b',
          auctionHighestBid: 200,
        }),
      }),
    );
    rerender(<Player />);
    expect(
      screen.queryByText(/вашу ставку перебили/i),
    ).not.toBeInTheDocument();
  });

  it('does not show the toast when I become the new leader myself', () => {
    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'other',
          auctionHighestBid: 100,
        }),
      }),
    );
    const { rerender } = render(<Player />);

    mockedUseRoomConnection.mockReturnValue(
      connection({
        selfId: 'me',
        game: baseGame({
          phase: 'auction-bidding',
          auctionHighestBidderParticipantId: 'me',
          auctionHighestBid: 150,
        }),
      }),
    );
    rerender(<Player />);
    expect(
      screen.queryByText(/вашу ставку перебили/i),
    ).not.toBeInTheDocument();
  });
});
```

В начало файла, в существующий импорт из `'@testing-library/react'`, добавить `act`:

```ts
import { act, render, screen } from '@testing-library/react';
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

```bash
cd client
npx vitest run src/Player.test.tsx
```

Expected: FAIL — все пять новых тестов ищут текст «вашу ставку перебили», которого пока
нигде нет.

- [ ] **Step 3: Добавить состояние и эффекты в `Player.tsx`**

После существующего блока эффектов и перед `function nameOf` (после строки с `}, [game?.phase]);`,
закрывающей эффект сброса `bidInput`, и перед `function nameOf(participantId...`) добавить:

```ts
// Предыдущее значение лидера торгов — нужно только для сравнения внутри
// эффекта ниже, в разметке не участвует, поэтому useRef, а не useState.
const previousHighestBidderRef = useRef<string | null>(null);
const [outbidNotice, setOutbidNotice] = useState<{
  newLeaderName: string;
  amount: number;
} | null>(null);

useEffect(() => {
  const previous = previousHighestBidderRef.current;
  const current = game?.auctionHighestBidderParticipantId ?? null;
  previousHighestBidderRef.current = current;
  // previous === selfId — единственный случай, когда именно я только что
  // был лидером торгов и им быть перестал (design.md, «Механизм
  // обнаружения»). Переход с null (первая ставка в аукционе) или между
  // двумя чужими id меня не касается.
  if (
    game?.phase === 'auction-bidding' &&
    previous === selfId &&
    current !== null &&
    current !== selfId
  ) {
    setOutbidNotice({
      newLeaderName: nameOf(current),
      amount: game.auctionHighestBid ?? 0,
    });
  }
}, [game?.auctionHighestBidderParticipantId, game?.phase, selfId]);

useEffect(() => {
  if (!outbidNotice) return;
  const timer = setTimeout(() => setOutbidNotice(null), 4000);
  return () => clearTimeout(timer);
}, [outbidNotice]);
```

(Именно после `nameOf`'s определения размещать не нужно — функция объявлена через `function`,
поднимается в начало области видимости компонента, вызов из эффекта выше корректен.
Разместить нужно **после** блока `useEffect(() => { if (game?.phase !== 'auction-bidding')
setBidInput(''); }, [game?.phase]);` и **перед** `function nameOf(...)`, чтобы визуально
остаться в группе остальных эффектов сброса состояния по фазе.)

- [ ] **Step 4: Добавить тост в разметку**

В самом конце файла заменить финальный `return`:

```ts
  return isHost && !isFinalPhase ? (
    <>
      {phaseContent}
      {hostAdminPanel()}
    </>
  ) : (
    phaseContent
  );
}
```

на:

```ts
  return (
    <>
      {outbidNotice && (
        <div className="player-toast" role="status">
          Вашу ставку перебили — {outbidNotice.newLeaderName} поставил{' '}
          {outbidNotice.amount}
        </div>
      )}
      {isHost && !isFinalPhase ? (
        <>
          {phaseContent}
          {hostAdminPanel()}
        </>
      ) : (
        phaseContent
      )}
    </>
  );
}
```

- [ ] **Step 5: Прогнать тесты снова**

```bash
npx vitest run src/Player.test.tsx
```

Expected: все тесты зелёные, включая полный существующий набор файла.

- [ ] **Step 6: Добавить стиль тоста**

`client/src/index.css` — новый класс после `.player-hint`:

```css
.player-toast {
  position: fixed;
  top: 16px;
  right: 16px;
  max-width: min(320px, calc(100vw - 32px));
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  font-size: 15px;
  z-index: 10;
}
```

- [ ] **Step 7: Полная проверка**

```bash
cd ..
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: всё зелёное. Эта задача не трогает сервер, но полный прогон подтверждает, что
клиентская сборка (`vite build`) не сломалась от новой разметки и стилей.

- [ ] **Step 8: Commit**

```bash
git add client/src/Player.tsx client/src/Player.test.tsx client/src/index.css
git commit -m "feat: show a toast when a player's auction bid gets outbid"
```

---

## После плана

Ручная проверка вживую (два телефона, один открывает аукцион и ставит, другой перебивает) —
короткая, не отдельный вечер игры: убедиться, что тост читается за 4 секунды, не перекрывает
кнопки, и текст с именем/суммой верный. Это полировка уже сыгранной механики, а не новая
веха — отдельного пункта «сыграть партию» для неё не требуется.
