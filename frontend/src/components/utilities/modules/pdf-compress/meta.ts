import { FileText } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'pdf-compress',
  name: 'PDF Compression',
  description: 'Shrink PDFs losslessly, or by downsampling their images when that is not enough.',
  category: 'files',
  icon: FileText,
  keywords: ['pdf', 'compress', 'shrink', 'ghostscript', 'qpdf', 'document', 'downsample', 'optimize', 'linearize'],
};

export default meta;
