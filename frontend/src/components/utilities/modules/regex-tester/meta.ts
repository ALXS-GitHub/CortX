import { Regex } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'regex-tester',
  name: 'Regex Tester',
  description: 'Test a pattern live: highlighted matches, capture groups and replace preview.',
  category: 'text',
  icon: Regex,
  keywords: ['regexp', 'regular expression', 'match', 'capture', 'replace', 'pattern'],
};

export default meta;
