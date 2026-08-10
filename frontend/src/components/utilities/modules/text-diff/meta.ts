import { GitCompareArrows } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'text-diff',
  name: 'Text Diff',
  description: 'Compare two texts side by side or inline, by line, word or character.',
  category: 'text',
  icon: GitCompareArrows,
  keywords: ['diff', 'compare', 'changes', 'patch', 'merge', 'difference'],
};

export default meta;
