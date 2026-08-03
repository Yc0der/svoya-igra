import { QRCodeSVG } from 'qrcode.react';
import { useRoomConnection } from './useRoomConnection';

export function Board() {
  const { participants, lanUrl } = useRoomConnection();

  return (
    <div>
      <h1>Своя игра</h1>
      {lanUrl && (
        <>
          <QRCodeSVG value={lanUrl} size={200} title="QR-код для входа" />
          <p>{lanUrl}</p>
        </>
      )}
      <ul>
        {participants.map((p) => (
          <li key={p.id}>
            {p.name} {p.connected ? '' : '(отключён)'}
          </li>
        ))}
      </ul>
    </div>
  );
}
