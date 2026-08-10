import { AppWindowMac } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'icon-set',
  name: 'Icon Set Generator',
  description: 'Turn one image into a favicon.ico plus every PNG size a web or Tauri app needs.',
  category: 'image',
  icon: AppWindowMac,
  keywords: ['favicon', 'ico', 'pwa', 'app icon', 'tauri', 'apple touch', 'manifest', 'sizes'],
};

export default meta;
