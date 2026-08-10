import qrcode from 'qrcode-generator';

export type PayloadKind = 'text' | 'url' | 'wifi' | 'email' | 'phone' | 'sms' | 'vcard';

export const PAYLOAD_LABELS: Record<PayloadKind, string> = {
  text: 'Plain text',
  url: 'URL',
  wifi: 'Wi-Fi network',
  email: 'Email',
  phone: 'Phone number',
  sms: 'SMS',
  vcard: 'Contact card (vCard)',
};

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export const ERROR_CORRECTION_LABELS: Record<ErrorCorrection, string> = {
  L: 'L — 7% recoverable',
  M: 'M — 15% recoverable',
  Q: 'Q — 25% recoverable',
  H: 'H — 30% recoverable (needed for a logo)',
};

export interface PayloadFields {
  text: string;
  url: string;
  wifiSsid: string;
  wifiPassword: string;
  wifiSecurity: 'WPA' | 'WEP' | 'nopass';
  wifiHidden: boolean;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  phone: string;
  smsNumber: string;
  smsMessage: string;
  vcardName: string;
  vcardOrg: string;
  vcardTitle: string;
  vcardPhone: string;
  vcardEmail: string;
  vcardUrl: string;
}

/** Escapes the characters that terminate a field in the WIFI:/vCard grammars. */
function escapeField(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

export function buildPayload(kind: PayloadKind, fields: PayloadFields): string {
  switch (kind) {
    case 'text':
      return fields.text;

    case 'url': {
      const url = fields.url.trim();
      if (!url) return '';
      return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    }

    case 'wifi': {
      if (!fields.wifiSsid) return '';
      const parts = [
        `T:${fields.wifiSecurity}`,
        `S:${escapeField(fields.wifiSsid)}`,
        fields.wifiSecurity !== 'nopass' ? `P:${escapeField(fields.wifiPassword)}` : '',
        fields.wifiHidden ? 'H:true' : '',
      ].filter(Boolean);
      return `WIFI:${parts.join(';')};;`;
    }

    case 'email': {
      if (!fields.emailTo) return '';
      const query = new URLSearchParams();
      if (fields.emailSubject) query.set('subject', fields.emailSubject);
      if (fields.emailBody) query.set('body', fields.emailBody);
      const suffix = query.toString();
      return `mailto:${fields.emailTo}${suffix ? `?${suffix}` : ''}`;
    }

    case 'phone':
      return fields.phone ? `tel:${fields.phone.replace(/\s+/g, '')}` : '';

    case 'sms':
      return fields.smsNumber
        ? `SMSTO:${fields.smsNumber.replace(/\s+/g, '')}:${fields.smsMessage}`
        : '';

    case 'vcard': {
      if (!fields.vcardName) return '';
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${escapeField(fields.vcardName)}`,
        `FN:${escapeField(fields.vcardName)}`,
        fields.vcardOrg ? `ORG:${escapeField(fields.vcardOrg)}` : '',
        fields.vcardTitle ? `TITLE:${escapeField(fields.vcardTitle)}` : '',
        fields.vcardPhone ? `TEL;TYPE=CELL:${fields.vcardPhone}` : '',
        fields.vcardEmail ? `EMAIL:${fields.vcardEmail}` : '',
        fields.vcardUrl ? `URL:${fields.vcardUrl}` : '',
        'END:VCARD',
      ]
        .filter(Boolean)
        .join('\n');
    }
  }
}

export interface Matrix {
  size: number;
  isDark(row: number, col: number): boolean;
}

/**
 * `typeNumber: 0` lets the library pick the smallest version that fits, which
 * is what anyone wants: a bigger version only means denser modules.
 */
export function buildMatrix(payload: string, level: ErrorCorrection): Matrix {
  const qr = qrcode(0, level);
  qr.addData(payload);
  qr.make();
  return { size: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

export interface DrawOptions {
  moduleSize: number;
  margin: number;
  foreground: string;
  background: string;
  rounded: boolean;
  /** Fraction of the code's width cleared in the middle for a logo, 0-0.3. */
  logoRatio: number;
}

export function matrixPixelSize(matrix: Matrix, options: DrawOptions): number {
  return (matrix.size + options.margin * 2) * options.moduleSize;
}

export function drawMatrix(
  canvas: HTMLCanvasElement,
  matrix: Matrix,
  options: DrawOptions,
  logo?: ImageBitmap | null,
): void {
  const pixels = matrixPixelSize(matrix, options);
  canvas.width = pixels;
  canvas.height = pixels;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  context.fillStyle = options.background;
  context.fillRect(0, 0, pixels, pixels);
  context.fillStyle = options.foreground;

  const offset = options.margin * options.moduleSize;
  const clear = options.logoRatio > 0 ? logoBox(matrix, options) : null;

  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.isDark(row, col)) continue;

      const x = offset + col * options.moduleSize;
      const y = offset + row * options.moduleSize;

      // Skip the modules the logo would cover: the error correction is what
      // makes the code still scan, so this must stay within the chosen ratio.
      if (clear && x + options.moduleSize > clear.x && x < clear.x + clear.size &&
          y + options.moduleSize > clear.y && y < clear.y + clear.size) {
        continue;
      }

      if (options.rounded) {
        context.beginPath();
        context.roundRect(x, y, options.moduleSize, options.moduleSize, options.moduleSize * 0.35);
        context.fill();
      } else {
        context.fillRect(x, y, options.moduleSize, options.moduleSize);
      }
    }
  }

  if (logo && clear) {
    const inset = clear.size * 0.08;
    context.drawImage(logo, clear.x + inset, clear.y + inset, clear.size - inset * 2, clear.size - inset * 2);
  }
}

function logoBox(matrix: Matrix, options: DrawOptions) {
  const pixels = matrixPixelSize(matrix, options);
  const size = Math.round(pixels * Math.min(0.3, Math.max(0, options.logoRatio)));
  return { x: Math.round((pixels - size) / 2), y: Math.round((pixels - size) / 2), size };
}

/** Hand-built SVG so the export stays crisp at any size. */
export function toSvg(matrix: Matrix, options: DrawOptions): string {
  const pixels = matrixPixelSize(matrix, options);
  const offset = options.margin * options.moduleSize;
  const clear = options.logoRatio > 0 ? logoBox(matrix, options) : null;
  const radius = options.rounded ? options.moduleSize * 0.35 : 0;

  const shapes: string[] = [];

  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.isDark(row, col)) continue;

      const x = offset + col * options.moduleSize;
      const y = offset + row * options.moduleSize;

      if (clear && x + options.moduleSize > clear.x && x < clear.x + clear.size &&
          y + options.moduleSize > clear.y && y < clear.y + clear.size) {
        continue;
      }

      shapes.push(
        `<rect x="${x}" y="${y}" width="${options.moduleSize}" height="${options.moduleSize}"${
          radius ? ` rx="${radius.toFixed(2)}"` : ''
        }/>`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${pixels} ${pixels}">`,
    `<rect width="${pixels}" height="${pixels}" fill="${options.background}"/>`,
    `<g fill="${options.foreground}">${shapes.join('')}</g>`,
    '</svg>',
  ].join('');
}
