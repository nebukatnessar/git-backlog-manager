import { useState } from "react";
import type { DragEvent } from "react";
import { type WorkItem } from "../../src/shared/workItems";

export interface StackRankUpdate {
  issueNumber: number;
  stackRank: number;
}

const STACK_RANK_STEP = 1000;

// Re-space every visible item evenly, anchored on the first item's current rank
export function respaceStackRanks(newOrder: WorkItem[]): StackRankUpdate[] {
  const anchor = newOrder[0].stackRank ?? STACK_RANK_STEP;
  const currentRanks = new Map(newOrder.map((item) => [item.number, item.stackRank]));
  return newOrder
    .map((item, index) => ({ issueNumber: item.number, stackRank: Math.max(1, anchor + index * STACK_RANK_STEP) }))
    .filter((update) => currentRanks.get(update.issueNumber) !== update.stackRank);
}

// Compute the stack-rank updates needed to keep a list ordered after a drag,
// placing the moved item at index `to` in `newOrder`
export function computeStackRankUpdates(newOrder: WorkItem[], to: number): StackRankUpdate[] {
  if (newOrder.length < 2) return [];

  const movedItem = newOrder[to];
  const previousRank = to > 0 ? newOrder[to - 1].stackRank : undefined;
  const nextRank = to < newOrder.length - 1 ? newOrder[to + 1].stackRank : undefined;

  if (previousRank !== undefined && nextRank !== undefined) {
    const midpoint = Math.floor((previousRank + nextRank) / 2);
    if (midpoint > previousRank) {
      return [{ issueNumber: movedItem.number, stackRank: midpoint }];
    }
    // No room between the neighbours: re-space the visible items evenly
    return respaceStackRanks(newOrder);
  }

  const knownRanks = newOrder
    .map((item) => item.stackRank)
    .filter((rank): rank is number => rank !== undefined);

  let newRank: number;
  if (previousRank !== undefined) {
    newRank = previousRank + STACK_RANK_STEP;
  } else if (nextRank !== undefined) {
    newRank = Math.max(1, nextRank - STACK_RANK_STEP);
  } else if (knownRanks.length > 0) {
    newRank = Math.max(...knownRanks) + STACK_RANK_STEP;
  } else {
    newRank = STACK_RANK_STEP;
  }

  if (newRank === movedItem.stackRank) return [];
  return [{ issueNumber: movedItem.number, stackRank: newRank }];
}

export interface StackRankDragOrder {
  canReorder: boolean;
  length: number;
  draggedNumber: number | null;
  dropIndex: number | null;
  handleDragStart: (event: DragEvent, index: number) => void;
  handleDragOver: (event: DragEvent, index: number) => void;
  handleDrop: (event: DragEvent) => void;
  handleDragEnd: () => void;
}

// Native drag-and-drop reordering that persists the new order as stack-rank
// labels via onStackRankChange
export function useStackRankDragOrder(
  items: WorkItem[],
  onStackRankChange?: (issueNumber: number, stackRank: number) => Promise<void>
): StackRankDragOrder {
  const [draggedNumber, setDraggedNumber] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const canReorder = Boolean(onStackRankChange);

  const handleDragStart = (event: DragEvent, index: number): void => {
    // Stop parent draggables (nested lists) from starting their own reorder
    event.stopPropagation();
    setDraggedNumber(items[index].number);
    setDropIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(items[index].number));
  };

  const handleDragOver = (event: DragEvent, index: number): void => {
    if (draggedNumber === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropIndex(index + (after ? 1 : 0));
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const from = draggedNumber === null ? -1 : items.findIndex((item) => item.number === draggedNumber);
    const insertAt = dropIndex === null || from === -1 ? -1 : dropIndex > from ? dropIndex - 1 : dropIndex;
    setDraggedNumber(null);
    setDropIndex(null);
    if (from === -1 || insertAt === from || insertAt < 0 || !onStackRankChange) return;

    const without = items.filter((_item, index) => index !== from);
    const newOrder = [...without.slice(0, insertAt), items[from], ...without.slice(insertAt)];
    const updates = computeStackRankUpdates(newOrder, insertAt);
    void Promise.all(updates.map((update) => onStackRankChange(update.issueNumber, update.stackRank)));
  };

  const handleDragEnd = (): void => {
    setDraggedNumber(null);
    setDropIndex(null);
  };

  return {
    canReorder,
    length: items.length,
    draggedNumber,
    dropIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  };
}
