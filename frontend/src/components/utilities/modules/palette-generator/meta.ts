import { SwatchBook } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'palette-generator',
  name: 'Palette Generator',
  description: 'Build a palette from a base color or extract one from an image, then export it.',
  category: 'color',
  icon: SwatchBook,
  keywords: ['palette', 'scheme', 'complementary', 'triadic', 'analogous', 'extract', 'image', 'tailwind', 'css variables'],
};

export default meta;
