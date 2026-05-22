import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, GitBranch, GripVertical, Layers, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import type { BatchDependencyMode, BatchDependencyRule } from '../lib/agent-batch';
import {
  isExternalBoardDrag,
  readBoardCardDragData,
  readBoardCardsBulkDragData,
  readBoardColumnDragData,
} from '../lib/execution-plans-dnd';
import styles from './BatchLayerPlanner.module.css';

export interface BatchPlanCard {
  id: string;
  name: string;
  subtitle?: string | null;
  columnColor?: string | null;
  dependencyRule?: BatchDependencyRule;
}

export interface BatchLayer {
  cards: BatchPlanCard[];
}

export interface BatchLayerPlannerExperiments {
  acceptBoardDrag?: boolean;
  polish?: boolean;
  dependencyShortcuts?: boolean;
}

interface BatchLayerPlannerProps {
  layers: BatchLayer[];
  onChange: (layers: BatchLayer[]) => void;
  loadOptions: (query: string) => Promise<BatchPlanCard[]>;
  searchPlaceholder?: string;
  emptySearchLabel?: string;
  experiments?: BatchLayerPlannerExperiments;
  onExternalDragActive?: (active: boolean) => void;
}

// ─── Drag payload types ──────────────────────────────────────────────
type DragPayload = {
  cardId: string;
  fromLayer: number;
  fromIndex: number;
};

function getEffectiveDependencyMode(card: BatchPlanCard, layerIdx: number): BatchDependencyMode {
  return card.dependencyRule?.mode ?? (layerIdx > 0 ? 'previous_layer' : 'none');
}

function summarizeCardNames(cards: BatchPlanCard[]): string {
  if (cards.length === 0) return 'No dependency';
  const names = cards.slice(0, 2).map((card) => card.name).join(', ');
  return cards.length > 2 ? `${names} +${cards.length - 2}` : names;
}

function sanitizeDependencyRules(layers: BatchLayer[]): BatchLayer[] {
  return layers.map((layer, layerIdx) => {
    const earlierIds = new Set(
      layers.slice(0, layerIdx).flatMap((earlierLayer) => earlierLayer.cards.map((card) => card.id)),
    );

    return {
      cards: layer.cards.map((card) => {
        const rule = card.dependencyRule;
        if (!rule) return card;

        if (layerIdx === 0 && rule.mode !== 'none') {
          return { ...card, dependencyRule: { mode: 'none' } };
        }

        if (rule.mode !== 'specific_cards') return card;

        return {
          ...card,
          dependencyRule: {
            ...rule,
            cardIds: (rule.cardIds ?? []).filter((cardId, index, values) => (
              cardId !== card.id && earlierIds.has(cardId) && values.indexOf(cardId) === index
            )),
          },
        };
      }),
    };
  });
}

export function BatchLayerPlanner({
  layers,
  onChange,
  loadOptions,
  searchPlaceholder = 'Search cards…',
  emptySearchLabel = 'No matching cards',
  experiments,
  onExternalDragActive,
}: BatchLayerPlannerProps) {
  const acceptBoardDrag = experiments?.acceptBoardDrag ?? false;
  const polish = experiments?.polish ?? false;
  const dependencyShortcuts = experiments?.dependencyShortcuts ?? false;
  // ── Search / add cards ───────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<BatchPlanCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingDependencyCardId, setEditingDependencyCardId] = useState<string | null>(null);
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [externalDragActive, setExternalDragActive] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  const layerListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      setLoading(true);
      loadOptions(query.trim())
        .then((next) => { if (!cancelled) setOptions(next); })
        .catch(() => { if (!cancelled) setOptions([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [loadOptions, query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const allCardIds = useMemo(
    () => new Set(layers.flatMap((l) => l.cards.map((c) => c.id))),
    [layers],
  );
  const availableOptions = useMemo(
    () => options.filter((o) => !allCardIds.has(o.id)),
    [options, allCardIds],
  );

  const totalCards = useMemo(() => layers.reduce((s, l) => s + l.cards.length, 0), [layers]);
  const flatCards = useMemo(
    () => layers.flatMap((layer, layerIdx) => layer.cards.map((card) => ({ card, layerIdx }))),
    [layers],
  );
  const layerCount = useMemo(
    () => layers.filter((l) => l.cards.length > 0).length,
    [layers],
  );

  function emitChange(nextLayers: BatchLayer[]) {
    onChange(sanitizeDependencyRules(nextLayers));
  }

  function getDependencySummary(card: BatchPlanCard, layerIdx: number): string {
    const mode = getEffectiveDependencyMode(card, layerIdx);
    if (mode === 'none') return 'No dependency';

    const previousCards = layerIdx > 0 ? layers[layerIdx - 1]?.cards ?? [] : [];
    const earlierCards = flatCards
      .filter((entry) => entry.layerIdx < layerIdx)
      .map((entry) => entry.card);

    if (mode === 'previous_layer') {
      if (previousCards.length === 0) return 'No dependency';
      return `Layer ${layerIdx}: ${previousCards.length} card${previousCards.length === 1 ? '' : 's'}`;
    }
    if (mode === 'all_previous_layers') {
      return `All earlier: ${earlierCards.length} card${earlierCards.length === 1 ? '' : 's'}`;
    }

    const specificIds = new Set(card.dependencyRule?.cardIds ?? []);
    const specificCards = earlierCards.filter((entry) => specificIds.has(entry.id));
    return specificCards.length > 0 ? summarizeCardNames(specificCards) : 'Choose dependencies';
  }

  function setCardDependencyRule(layerIdx: number, cardIdx: number, rule: BatchDependencyRule) {
    emitChange(layers.map((layer, li) => {
      if (li !== layerIdx) return layer;
      return {
        cards: layer.cards.map((card, ci) => (
          ci === cardIdx ? { ...card, dependencyRule: rule } : card
        )),
      };
    }));
  }

  function setDependencyMode(layerIdx: number, cardIdx: number, mode: BatchDependencyMode) {
    const card = layers[layerIdx]?.cards[cardIdx];
    if (!card) return;
    setCardDependencyRule(layerIdx, cardIdx, {
      mode,
      cardIds: mode === 'specific_cards' ? card.dependencyRule?.cardIds ?? [] : undefined,
    });
  }

  function toggleSpecificDependency(layerIdx: number, cardIdx: number, dependencyCardId: string) {
    const card = layers[layerIdx]?.cards[cardIdx];
    if (!card) return;
    const selected = new Set(card.dependencyRule?.cardIds ?? []);
    if (selected.has(dependencyCardId)) {
      selected.delete(dependencyCardId);
    } else {
      selected.add(dependencyCardId);
    }
    setCardDependencyRule(layerIdx, cardIdx, {
      mode: 'specific_cards',
      cardIds: [...selected],
    });
  }

  function addCard(card: BatchPlanCard) {
    // Add to last layer (or create the first one)
    const next = layers.length === 0
      ? [{ cards: [card] }]
      : layers.map((l, i) => i === layers.length - 1 ? { cards: [...l.cards, card] } : l);
    emitChange(next);
  }

  function insertExternalAt(
    cards: BatchPlanCard[],
    toLayer: number,
    toIndex: number,
    asNewLayer: boolean,
  ) {
    const fresh = cards.filter((card) => !allCardIds.has(card.id));
    if (fresh.length === 0) return;

    if (asNewLayer) {
      const next = [...layers];
      next.splice(toLayer + 1, 0, { cards: fresh });
      emitChange(next.filter((layer) => layer.cards.length > 0));
      return;
    }

    let next = layers.length === 0 ? [{ cards: [] as BatchPlanCard[] }] : [...layers];
    if (toLayer >= next.length) {
      next = [...next, { cards: [] }];
    }
    next = next.map((layer, li) => {
      if (li !== toLayer) return layer;
      const updated = [...layer.cards];
      updated.splice(toIndex, 0, ...fresh);
      return { cards: updated };
    });
    emitChange(next.filter((layer) => layer.cards.length > 0));
  }

  function tryHandleExternalDrop(
    e: React.DragEvent,
    toLayer: number,
    toIndex: number,
    asNewLayer: boolean,
  ): boolean {
    if (!acceptBoardDrag || !isExternalBoardDrag(e.dataTransfer)) return false;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    setSepDropTarget(null);
    setIsDragging(false);
    setExternalDragActive(false);
    onExternalDragActive?.(false);
    dragRef.current = null;

    const columnPayload = readBoardColumnDragData(e.dataTransfer);
    if (columnPayload) {
      const columnCards = columnPayload.cards
        .filter((card) => !allCardIds.has(card.id))
        .map((card) => ({
          id: card.id,
          name: card.name,
          subtitle: columnPayload.columnName,
        }));
      insertExternalAt(columnCards, toLayer, toIndex, true);
      return true;
    }

    const bulk = readBoardCardsBulkDragData(e.dataTransfer);
    if (bulk && bulk.length > 0) {
      insertExternalAt(
        bulk.map((card) => ({ id: card.id, name: card.name, subtitle: card.columnName ?? null })),
        toLayer,
        toIndex,
        asNewLayer,
      );
      return true;
    }

    const payload = readBoardCardDragData(e.dataTransfer);
    if (payload) {
      insertExternalAt(
        [{
          id: payload.id,
          name: payload.name,
          subtitle: payload.columnName ?? null,
        }],
        toLayer,
        toIndex,
        asNewLayer,
      );
      return true;
    }

    return false;
  }

  function setLayerDependencyDefaults(layerIdx: number, mode: BatchDependencyMode) {
    emitChange(layers.map((layer, li) => {
      if (li !== layerIdx) return layer;
      return {
        cards: layer.cards.map((card) => ({
          ...card,
          dependencyRule: { mode: li === 0 && mode !== 'none' ? 'none' : mode },
        })),
      };
    }));
  }

  function copyDependencyFromAbove(layerIdx: number, cardIdx: number) {
    if (cardIdx === 0) return;
    const above = layers[layerIdx]?.cards[cardIdx - 1];
    if (!above?.dependencyRule) return;
    setCardDependencyRule(layerIdx, cardIdx, { ...above.dependencyRule });
  }

  function removeCard(layerIdx: number, cardIdx: number) {
    const next = layers.map((l, li) =>
      li === layerIdx ? { cards: l.cards.filter((_, ci) => ci !== cardIdx) } : l,
    ).filter((l) => l.cards.length > 0);
    emitChange(next.length === 0 ? [{ cards: [] }] : next);
  }

  function clearAll() {
    emitChange([{ cards: [] }]);
  }

  // ── Split / merge layers ─────────────────────────────────────────
  function splitAfter(layerIdx: number, cardIdx: number) {
    const layer = layers[layerIdx];
    if (cardIdx >= layer.cards.length - 1) return; // already last card
    const before = layer.cards.slice(0, cardIdx + 1);
    const after = layer.cards.slice(cardIdx + 1);
    const next = [
      ...layers.slice(0, layerIdx),
      { cards: before },
      { cards: after },
      ...layers.slice(layerIdx + 1),
    ];
    emitChange(next);
  }

  function mergeLayers(layerIdx: number) {
    // Merge this layer into the previous one
    if (layerIdx === 0) return;
    const prev = layers[layerIdx - 1];
    const cur = layers[layerIdx];
    const next = [
      ...layers.slice(0, layerIdx - 1),
      { cards: [...prev.cards, ...cur.cards] },
      ...layers.slice(layerIdx + 1),
    ];
    emitChange(next);
  }

  // ── Drag and drop ────────────────────────────────────────────────
  const dragRef = useRef<DragPayload | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ layerIdx: number; cardIdx: number } | null>(null);

  function handleDragStart(e: React.DragEvent, layerIdx: number, cardIdx: number, card: BatchPlanCard) {
    dragRef.current = { cardId: card.id, fromLayer: layerIdx, fromIndex: cardIdx };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
    // Slight delay so the dragged element renders before we style it
    setIsDragging(true);
    requestAnimationFrame(() => {
      const el = e.target as HTMLElement;
      el.classList.add(styles.dragging);
    });
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.target as HTMLElement).classList.remove(styles.dragging);
    dragRef.current = null;
    setIsDragging(false);
    setDropTarget(null);
  }

  function handleDragOver(e: React.DragEvent, layerIdx: number, cardIdx: number) {
    if (acceptBoardDrag && isExternalBoardDrag(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setExternalDragActive(true);
      onExternalDragActive?.(true);
      setDropTarget({ layerIdx, cardIdx });
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ layerIdx, cardIdx });
  }

  function handleLayerDragOver(e: React.DragEvent, layerIdx: number) {
    if (acceptBoardDrag && isExternalBoardDrag(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setExternalDragActive(true);
      onExternalDragActive?.(true);
      const layer = layers[layerIdx];
      setDropTarget({ layerIdx, cardIdx: layer?.cards.length ?? 0 });
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const layer = layers[layerIdx];
    setDropTarget({ layerIdx, cardIdx: layer?.cards.length ?? 0 });
  }

  function handleDrop(e: React.DragEvent, toLayer: number, toIndex: number) {
    if (tryHandleExternalDrop(e, toLayer, toIndex, false)) return;

    e.preventDefault();
    setDropTarget(null);
    setIsDragging(false);
    const payload = dragRef.current;
    if (!payload) return;
    dragRef.current = null;

    const { fromLayer, fromIndex } = payload;

    // Build a new layers array with the card moved
    const card = layers[fromLayer].cards[fromIndex];
    if (!card) return;

    // Remove from source
    let next = layers.map((l, li) =>
      li === fromLayer ? { cards: l.cards.filter((_, ci) => ci !== fromIndex) } : l,
    );

    // Adjust target index if same layer and source was before target
    let adjustedToIndex = toIndex;
    if (fromLayer === toLayer && fromIndex < toIndex) {
      adjustedToIndex = Math.max(0, toIndex - 1);
    }

    if (toLayer >= next.length) {
      next = [...next, { cards: [] }];
    }

    // Insert at target
    next = next.map((l, li) => {
      if (li !== toLayer) return l;
      const cards = [...l.cards];
      cards.splice(adjustedToIndex, 0, card);
      return { cards };
    });

    // Remove empty layers
    next = next.filter((l) => l.cards.length > 0);
    if (next.length === 0) next = [{ cards: [card] }];

    emitChange(next);
  }

  // ── Separator drop zone (drop between layers to create new layer) ──
  const [sepDropTarget, setSepDropTarget] = useState<number | null>(null);

  function handleSepDragOver(e: React.DragEvent, afterLayerIdx: number) {
    if (acceptBoardDrag && isExternalBoardDrag(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setExternalDragActive(true);
      onExternalDragActive?.(true);
      setSepDropTarget(afterLayerIdx);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setSepDropTarget(afterLayerIdx);
  }

  function handleSepDragLeave() {
    setSepDropTarget(null);
  }

  function handleSepDrop(e: React.DragEvent, afterLayerIdx: number) {
    if (tryHandleExternalDrop(e, afterLayerIdx, 0, true)) return;

    e.preventDefault();
    setSepDropTarget(null);
    setIsDragging(false);
    const payload = dragRef.current;
    if (!payload) return;
    dragRef.current = null;

    const { fromLayer, fromIndex } = payload;
    const card = layers[fromLayer].cards[fromIndex];
    if (!card) return;

    // Remove from source
    let next = layers.map((l, li) =>
      li === fromLayer ? { cards: l.cards.filter((_, ci) => ci !== fromIndex) } : l,
    );

    // Insert new layer after afterLayerIdx
    const insertAt = afterLayerIdx + 1;
    next.splice(insertAt, 0, { cards: [card] });

    // Remove empty layers
    next = next.filter((l) => l.cards.length > 0);
    if (next.length === 0) next = [{ cards: [card] }];

    emitChange(next);
  }

  useEffect(() => {
    if (!polish) return;

    function onKeyDown(e: KeyboardEvent) {
      if (!focusedCardId || !layerListRef.current?.contains(document.activeElement)) return;
      const entry = flatCards.find(({ card }) => card.id === focusedCardId);
      if (!entry) return;

      const { layerIdx, card } = entry;
      const cardIdx = layers[layerIdx]?.cards.findIndex((c) => c.id === card.id) ?? -1;
      if (cardIdx < 0) return;

      if (e.key === 'ArrowUp' && cardIdx > 0) {
        e.preventDefault();
        const layer = layers[layerIdx];
        const next = [...layer.cards];
        [next[cardIdx - 1], next[cardIdx]] = [next[cardIdx], next[cardIdx - 1]];
        emitChange(layers.map((l, li) => (li === layerIdx ? { cards: next } : l)));
      } else if (e.key === 'ArrowDown' && cardIdx < (layers[layerIdx]?.cards.length ?? 0) - 1) {
        e.preventDefault();
        const layer = layers[layerIdx];
        const next = [...layer.cards];
        [next[cardIdx], next[cardIdx + 1]] = [next[cardIdx + 1], next[cardIdx]];
        emitChange(layers.map((l, li) => (li === layerIdx ? { cards: next } : l)));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        splitAfter(layerIdx, cardIdx);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeCard(layerIdx, cardIdx);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedCardId, flatCards, layers, polish]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ───────────────────────────────────────────────────────
  function renderDependencyEditor(card: BatchPlanCard, layerIdx: number, cardIdx: number) {
    const mode = getEffectiveDependencyMode(card, layerIdx);
    const earlierCards = flatCards.filter((entry) => entry.layerIdx < layerIdx);
    const selectedSpecificIds = new Set(card.dependencyRule?.cardIds ?? []);
    const modeOptions: Array<{ mode: BatchDependencyMode; label: string; disabled?: boolean }> = [
      { mode: 'previous_layer', label: 'Previous layer', disabled: layerIdx === 0 },
      { mode: 'specific_cards', label: 'Specific cards', disabled: earlierCards.length === 0 },
      { mode: 'all_previous_layers', label: 'All earlier', disabled: earlierCards.length === 0 },
      { mode: 'none', label: 'No dependency' },
    ];

    const cardAbove = cardIdx > 0 ? layers[layerIdx]?.cards[cardIdx - 1] : null;

    return (
      <div className={styles.dependencyEditor}>
        {dependencyShortcuts && layerIdx > 0 && cardAbove?.dependencyRule && (
          <button
            type="button"
            className={styles.dependencyShortcutBtn}
            onClick={() => copyDependencyFromAbove(layerIdx, cardIdx)}
          >
            <Copy size={11} />
            Same as card above
          </button>
        )}
        <div className={styles.dependencyModes}>
          {modeOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={`${styles.dependencyModeBtn} ${mode === option.mode ? styles.dependencyModeBtnActive : ''}`}
              disabled={option.disabled}
              onClick={() => setDependencyMode(layerIdx, cardIdx, option.mode)}
            >
              {mode === option.mode && <Check size={11} />}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        {mode === 'specific_cards' && (
          <div className={styles.specificDependencyList}>
            {earlierCards.length === 0 ? (
              <div className={styles.specificDependencyEmpty}>Move this card below another layer first.</div>
            ) : (
              earlierCards.map(({ card: dependencyCard, layerIdx: dependencyLayerIdx }) => (
                <label key={dependencyCard.id} className={styles.specificDependencyOption}>
                  <input
                    type="checkbox"
                    checked={selectedSpecificIds.has(dependencyCard.id)}
                    onChange={() => toggleSpecificDependency(layerIdx, cardIdx, dependencyCard.id)}
                  />
                  <span className={styles.specificDependencyName}>{dependencyCard.name}</span>
                  <span className={styles.specificDependencyLayer}>L{dependencyLayerIdx + 1}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  const displayLayers = useMemo(() => {
    if (!polish) return layers;
    const hasTrailingEmpty = layers.length > 0 && layers[layers.length - 1].cards.length === 0;
    return hasTrailingEmpty ? layers : [...layers, { cards: [] }];
  }, [layers, polish]);

  const showExternalHint = acceptBoardDrag && (externalDragActive || isDragging);
  const nonEmptyDisplayLayerCount = displayLayers.filter((l) => l.cards.length > 0).length;

  return (
    <div
      className={`${styles.root} ${showExternalHint ? styles.rootExternalDrag : ''}`}
      data-external-drag={showExternalHint ? 'true' : undefined}
    >
      {/* Search / add */}
      <div className={styles.combobox} ref={comboRef}>
        <div className={styles.searchBox}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={searchPlaceholder}
          />
        </div>
        {open && (
          <div className={styles.dropdown}>
            {loading && availableOptions.length === 0 ? (
              <div className={styles.dropdownEmpty}>Searching...</div>
            ) : availableOptions.length === 0 ? (
              <div className={styles.dropdownEmpty}>{emptySearchLabel}</div>
            ) : (
              availableOptions.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className={styles.dropdownItem}
                  onClick={() => addCard(card)}
                >
                  <div className={styles.dropdownItemText}>
                    <div className={styles.dropdownItemName}>{card.name}</div>
                    {card.subtitle && <div className={styles.dropdownItemSub}>{card.subtitle}</div>}
                  </div>
                  <Plus size={14} className={styles.dropdownItemAdd} />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Header row */}
      {totalCards > 0 && (
        <div className={styles.listHeader}>
          <span className={styles.listLabel}>
            {totalCards} card{totalCards !== 1 ? 's' : ''}
            {layerCount > 1
              ? ` in ${layerCount} layers`
              : ''}
          </span>
          <button type="button" className={styles.clearBtn} onClick={clearAll}>
            Clear
          </button>
        </div>
      )}

      {/* Layers */}
      {totalCards === 0 && !polish ? (
        <div
          className={`${styles.emptyState} ${acceptBoardDrag ? styles.emptyStateDropTarget : ''}`}
          onDragOver={(e) => {
            if (!acceptBoardDrag) return;
            e.preventDefault();
            setExternalDragActive(true);
            onExternalDragActive?.(true);
          }}
          onDragLeave={() => {
            setExternalDragActive(false);
            onExternalDragActive?.(false);
          }}
          onDrop={(e) => tryHandleExternalDrop(e, 0, 0, false)}
        >
          {acceptBoardDrag
            ? 'Search or drag board cards here to start a plan.'
            : 'Add cards above. Drag them into groups to create dependency layers.'}
        </div>
      ) : (
        <div
          className={styles.layerList}
          ref={layerListRef}
          tabIndex={polish ? 0 : undefined}
        >
          {displayLayers.map((layer, layerIdx) => {
            if (layer.cards.length === 0 && !polish) return null;
            const layerNumber = displayLayers
              .slice(0, layerIdx + 1)
              .filter((l) => l.cards.length > 0).length;
            const isEmptySlot = layer.cards.length === 0;
            const displayLayerNumber = isEmptySlot ? nonEmptyDisplayLayerCount + 1 : layerNumber;

            return (
              <div key={layerIdx}>
                {/* Separator / merge zone between layers */}
                {layerIdx > 0 && layers[layerIdx - 1].cards.length > 0 && (
                  <div
                    className={`${styles.layerSeparator} ${isDragging ? styles.layerSeparatorDragging : ''} ${sepDropTarget === layerIdx - 1 ? styles.layerSeparatorActive : ''}`}
                    onDragOver={(e) => handleSepDragOver(e, layerIdx - 1)}
                    onDragLeave={handleSepDragLeave}
                    onDrop={(e) => handleSepDrop(e, layerIdx - 1)}
                  >
                    <div className={styles.separatorLine} />
                    <button
                      type="button"
                      className={styles.separatorMergeBtn}
                      onClick={() => mergeLayers(layerIdx)}
                      title="Merge with layer above"
                    >
                      <X size={10} />
                    </button>
                    <div className={styles.separatorLine} />
                  </div>
                )}

                <div
                  className={`${styles.layer} ${
                    isEmptySlot ? styles.layerEmptySlot : ''
                  } ${
                    dropTarget?.layerIdx === layerIdx && dropTarget.cardIdx === layer.cards.length
                      ? styles.layerDropTarget
                      : ''
                  }`}
                  onDragOver={(e) => handleLayerDragOver(e, layerIdx)}
                  onDrop={(e) => handleDrop(e, layerIdx, layer.cards.length)}
                >
                  {/* Layer label */}
                  {(layerCount > 1 || isEmptySlot) && (
                    <div className={styles.layerLabel}>
                      <span className={styles.layerLabelMain}>
                        <Layers size={11} />
                        <span>{isEmptySlot ? 'Empty layer' : `Layer ${displayLayerNumber}`}</span>
                      </span>
                      {!isEmptySlot && layerNumber === 1 && (
                        <span className={styles.layerHint}>runs first</span>
                      )}
                      {!isEmptySlot && layerNumber > 1 && (
                        <span className={styles.layerHint}>
                          waits for layer {layerNumber - 1}
                        </span>
                      )}
                      {dependencyShortcuts && !isEmptySlot && layerIdx > 0 && (
                        <span className={styles.layerShortcutGroup}>
                          <button
                            type="button"
                            className={styles.layerShortcutBtn}
                            onClick={() => setLayerDependencyDefaults(layerIdx, 'previous_layer')}
                          >
                            Wait for layer above
                          </button>
                          <button
                            type="button"
                            className={styles.layerShortcutBtn}
                            onClick={() => setLayerDependencyDefaults(layerIdx, 'none')}
                          >
                            Independent
                          </button>
                        </span>
                      )}
                    </div>
                  )}

                  {isEmptySlot && (
                    <div className={styles.emptyLayerHint}>
                      Drop cards here
                    </div>
                  )}

                  {layer.cards.map((card, cardIdx) => (
                    <div key={card.id} className={styles.cardWrap}>
                      <div
                        className={`${styles.card} ${
                          dropTarget?.layerIdx === layerIdx && dropTarget?.cardIdx === cardIdx
                            ? styles.cardDropBefore
                            : ''
                        } ${focusedCardId === card.id && polish ? styles.cardFocused : ''}`}
                        draggable
                        tabIndex={polish ? 0 : undefined}
                        onFocus={() => setFocusedCardId(card.id)}
                        onDragStart={(e) => handleDragStart(e, layerIdx, cardIdx, card)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, layerIdx, cardIdx)}
                        onDrop={(e) => { e.stopPropagation(); handleDrop(e, layerIdx, cardIdx); }}
                      >
                        {card.columnColor && (
                          <span
                            className={styles.cardColumnStrip}
                            style={{ background: card.columnColor }}
                            aria-hidden
                          />
                        )}
                        <div className={styles.cardGrip}>
                          <GripVertical size={14} />
                        </div>
                        <div className={styles.cardBody}>
                          <div className={styles.cardName}>{card.name}</div>
                          {card.subtitle && <div className={styles.cardSub}>{card.subtitle}</div>}
                          {totalCards > 1 && (
                            <button
                              type="button"
                              className={styles.dependencySummary}
                              onClick={() => setEditingDependencyCardId((current) => (
                                current === card.id ? null : card.id
                              ))}
                            >
                              <GitBranch size={11} />
                              <span>Blocked by: {getDependencySummary(card, layerIdx)}</span>
                            </button>
                          )}
                        </div>
                        <div className={styles.cardActions}>
                          {totalCards > 1 && (
                            <button
                              type="button"
                              className={styles.dependencyBtn}
                              onClick={() => setEditingDependencyCardId((current) => (
                                current === card.id ? null : card.id
                              ))}
                              aria-label="Edit dependencies"
                            >
                              <Link2 size={13} />
                            </button>
                          )}
                          {/* Split: creates a new layer boundary after this card */}
                          {cardIdx < layer.cards.length - 1 && (
                            <button
                              type="button"
                              className={styles.splitBtn}
                              onClick={() => splitAfter(layerIdx, cardIdx)}
                              title="Split into new layer after this card"
                            >
                              <Layers size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={() => removeCard(layerIdx, cardIdx)}
                            aria-label="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {editingDependencyCardId === card.id && renderDependencyEditor(card, layerIdx, cardIdx)}
                    </div>
                  ))}
                </div>

                {/* Drop zone / button after last layer to create a new layer below */}
                {layerIdx === displayLayers.length - 1
                  && displayLayers.filter((l) => l.cards.length > 0).length >= 1
                  && !isEmptySlot
                  && (
                  <div
                    className={`${styles.newLayerDropZone} ${isDragging ? styles.newLayerDropZoneDragging : ''} ${sepDropTarget === layerIdx ? styles.newLayerDropZoneActive : ''}`}
                    onDragOver={(e) => handleSepDragOver(e, layerIdx)}
                    onDragLeave={handleSepDragLeave}
                    onDrop={(e) => handleSepDrop(e, layerIdx)}
                  >
                    {isDragging ? (
                      <>
                        <Layers size={16} className={styles.newLayerDropIcon} />
                        <span className={styles.newLayerDropLabel}>Drop to create new layer</span>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={styles.newLayerBtn}
                        onClick={() => {
                          // Add an empty layer at the end — it will show once a card is dragged into it
                          // For now, split the last card into its own layer if there are 2+ cards
                          const lastLayer = layers[layers.length - 1];
                          if (lastLayer.cards.length >= 2) {
                            splitAfter(layers.length - 1, lastLayer.cards.length - 2);
                          }
                        }}
                      >
                        <Plus size={14} />
                        <span>New layer</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
