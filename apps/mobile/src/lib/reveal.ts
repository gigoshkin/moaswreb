/** How far a field's bottom edge sits under the keyboard's top edge (plus a margin), in px; 0 when it is clear of it. */
export const REVEAL_MARGIN = 24;

export const revealDelta = (fieldBottom: number, keyboardTop: number, margin = REVEAL_MARGIN): number => Math.max(0, Math.round(fieldBottom + margin - keyboardTop));
