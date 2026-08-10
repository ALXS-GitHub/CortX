import { Crop } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'image-crop',
  name: 'Crop & Rotate',
  description: 'Drag a selection on the preview, lock a ratio, rotate or flip, then export.',
  category: 'image',
  icon: Crop,
  keywords: ['crop', 'trim', 'rotate', 'flip', 'aspect ratio', 'preview', 'cut'],
};

export default meta;
