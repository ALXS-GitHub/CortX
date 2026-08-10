import { Palette } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'color-converter',
  name: 'Color Converter',
  description: 'Convert between hex, rgb, hsl, hsv and oklch, with WCAG contrast and a tint scale.',
  category: 'color',
  icon: Palette,
  keywords: ['hex', 'rgb', 'hsl', 'hsv', 'oklch', 'contrast', 'wcag', 'accessibility', 'shades'],
};

export default meta;
