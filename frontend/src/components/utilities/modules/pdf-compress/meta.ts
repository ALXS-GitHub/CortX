import { FileText } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'pdf-compress',
  name: 'PDF Compression',
  description: 'Shrink PDFs by downsampling their images, with presets from screen to prepress.',
  category: 'files',
  icon: FileText,
  keywords: ['pdf', 'compress', 'shrink', 'ghostscript', 'document', 'downsample', 'optimize'],
};

export default meta;
