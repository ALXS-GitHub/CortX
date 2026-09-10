/**
 * The glyph that stands for each kind of alias.
 *
 * A **table**, not a function that picks one: `const Glyph = aliasTypeGlyph(t)`
 * reads, to React and to the lint rule that guards it, as a component built
 * during the render — and a component type rebuilt on every render is a
 * different type every time, so React throws the subtree away and mounts a new
 * one, losing whatever state it held. A lookup can only ever hand back the
 * same three module-level components.
 *
 * It also lives outside `AliasCard.tsx` on purpose: a module that exports both
 * components and something else cannot be hot-replaced on its own.
 */
import type { ComponentType } from 'react';
import { FileCode, SquareTerminal, Zap } from 'lucide-react';
import type { AliasType } from '@/types';

export const ALIAS_TYPE_GLYPH: Record<AliasType, ComponentType<{ className?: string }>> = {
  function: SquareTerminal,
  script: FileCode,
  init: Zap,
};
