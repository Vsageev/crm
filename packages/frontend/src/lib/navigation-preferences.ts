const PREFERRED_FOLDER_ID_KEY = 'ws_preferred_folder_id';
const PREFERRED_BOARD_ID_KEY = 'ws_preferred_board_id';

function getStoredId(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (!value || value === 'undefined' || value === 'null') return null;
    return value;
  } catch {
    return null;
  }
}

function setStoredId(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

function clearStoredId(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function getPreferredFolderId(): string | null {
  return getStoredId(PREFERRED_FOLDER_ID_KEY);
}

export function setPreferredFolderId(folderId: string): void {
  setStoredId(PREFERRED_FOLDER_ID_KEY, folderId);
}

export function clearPreferredFolderId(): void {
  clearStoredId(PREFERRED_FOLDER_ID_KEY);
}

export function getPreferredBoardId(): string | null {
  return getStoredId(PREFERRED_BOARD_ID_KEY);
}

export function setPreferredBoardId(boardId: string): void {
  setStoredId(PREFERRED_BOARD_ID_KEY, boardId);
}

export function clearPreferredBoardId(): void {
  clearStoredId(PREFERRED_BOARD_ID_KEY);
}
