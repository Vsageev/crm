export const BOARD_CARD_MIME = 'application/x-openwork-board-card';
export const BOARD_COLUMN_MIME = 'application/x-openwork-board-column';
export const BOARD_CARDS_BULK_MIME = 'application/x-openwork-board-cards-bulk';

export type BoardCardDragPayload = {
  id: string;
  name: string;
  columnId?: string | null;
  columnName?: string | null;
};

export type BoardColumnDragPayload = {
  columnId: string;
  columnName: string;
  cards: BoardCardDragPayload[];
};

export function writeBoardCardDragData(
  dataTransfer: DataTransfer,
  payload: BoardCardDragPayload,
) {
  dataTransfer.setData(BOARD_CARD_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.id);
}

export function writeBoardColumnDragData(
  dataTransfer: DataTransfer,
  payload: BoardColumnDragPayload,
) {
  dataTransfer.setData(BOARD_COLUMN_MIME, JSON.stringify(payload));
  dataTransfer.setData('application/x-column-id', payload.columnId);
}

export function writeBoardCardsBulkDragData(
  dataTransfer: DataTransfer,
  cards: BoardCardDragPayload[],
) {
  dataTransfer.setData(BOARD_CARDS_BULK_MIME, JSON.stringify(cards));
  if (cards[0]) {
    dataTransfer.setData('text/plain', cards[0].id);
  }
}

export function readBoardCardDragData(dataTransfer: DataTransfer): BoardCardDragPayload | null {
  const raw = dataTransfer.getData(BOARD_CARD_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BoardCardDragPayload;
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readBoardColumnDragData(dataTransfer: DataTransfer): BoardColumnDragPayload | null {
  const raw = dataTransfer.getData(BOARD_COLUMN_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BoardColumnDragPayload;
    if (typeof parsed.columnId !== 'string' || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readBoardCardsBulkDragData(dataTransfer: DataTransfer): BoardCardDragPayload[] | null {
  const raw = dataTransfer.getData(BOARD_CARDS_BULK_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BoardCardDragPayload[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((card) => typeof card.id === 'string' && typeof card.name === 'string');
  } catch {
    return null;
  }
}

export function isExternalBoardDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(BOARD_CARD_MIME)
    || dataTransfer.types.includes(BOARD_COLUMN_MIME)
    || dataTransfer.types.includes(BOARD_CARDS_BULK_MIME);
}
