import { FileArchive } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'archives',
  name: 'ZIP Archives',
  description: 'Zip files and folders, or extract an archive, with exclusion patterns.',
  category: 'files',
  icon: FileArchive,
  keywords: ['zip', 'unzip', 'archive', 'compress', 'extract', 'folder', 'bundle'],
};

export default meta;
