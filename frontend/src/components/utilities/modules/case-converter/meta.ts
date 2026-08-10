import { CaseSensitive } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'case-converter',
  name: 'Case Converter & Slugify',
  description: 'Turn any text into camelCase, snake_case, kebab-case, Title Case or a URL slug.',
  category: 'text',
  icon: CaseSensitive,
  keywords: ['camel', 'pascal', 'snake', 'kebab', 'slug', 'title case', 'constant', 'naming'],
};

export default meta;
