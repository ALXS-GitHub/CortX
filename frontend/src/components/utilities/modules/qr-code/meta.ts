import { QrCode } from 'lucide-react';

import type { UtilityMeta } from '../../types';

const meta: UtilityMeta = {
  id: 'qr-code',
  name: 'QR Code Generator',
  description: 'Build a QR code for a URL, Wi-Fi network or contact card, and export PNG or SVG.',
  category: 'dev',
  icon: QrCode,
  keywords: ['qr', 'barcode', 'wifi', 'vcard', 'url', 'svg', 'png', 'share'],
};

export default meta;
