import { Eraser } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'strip-exif',
  name: 'Strip Metadata',
  description: 'Remove EXIF, GPS and other metadata from JPEG, PNG and WebP without recompressing.',
  category: 'image',
  icon: Eraser,
  keywords: ['exif', 'metadata', 'gps', 'privacy', 'xmp', 'iptc', 'clean', 'anonymize'],
};

export default meta;
