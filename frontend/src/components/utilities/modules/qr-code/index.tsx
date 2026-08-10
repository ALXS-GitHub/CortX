import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { FileDropZone } from '../../FileFields';
import { NumberField, PanelLayout, Row, SelectField, TextField, Toggle } from '../../fields';
import { IMAGE_FILTERS, blobToBytes, canvasToBlob, loadBitmap } from '../../lib/image';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import {
  ERROR_CORRECTION_LABELS,
  PAYLOAD_LABELS,
  buildMatrix,
  buildPayload,
  drawMatrix,
  toSvg,
  type DrawOptions,
  type ErrorCorrection,
  type PayloadFields,
  type PayloadKind,
} from './qr';

interface QrOptions extends PayloadFields, DrawOptions {
  kind: PayloadKind;
  level: ErrorCorrection;
  exportFormat: 'png' | 'svg';
  fileName: string;
}

const DEFAULT_OPTIONS: QrOptions = {
  kind: 'url',
  level: 'M',
  text: '',
  url: '',
  wifiSsid: '',
  wifiPassword: '',
  wifiSecurity: 'WPA',
  wifiHidden: false,
  emailTo: '',
  emailSubject: '',
  emailBody: '',
  phone: '',
  smsNumber: '',
  smsMessage: '',
  vcardName: '',
  vcardOrg: '',
  vcardTitle: '',
  vcardPhone: '',
  vcardEmail: '',
  vcardUrl: '',
  moduleSize: 8,
  margin: 4,
  foreground: '#000000',
  background: '#ffffff',
  rounded: false,
  logoRatio: 0,
  exportFormat: 'png',
  fileName: 'qrcode',
};

const KIND_OPTIONS = (Object.keys(PAYLOAD_LABELS) as PayloadKind[]).map((value) => ({
  value,
  label: PAYLOAD_LABELS[value],
}));

const LEVEL_OPTIONS = (Object.keys(ERROR_CORRECTION_LABELS) as ErrorCorrection[]).map((value) => ({
  value,
  label: ERROR_CORRECTION_LABELS[value],
}));

export default function QrCodePanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<QrOptions>(ctx, DEFAULT_OPTIONS);
  const [logo, setLogo] = useState<{ path: string; bitmap: ImageBitmap } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const payload = useMemo(() => buildPayload(options.kind, options), [options]);

  const matrix = useMemo(() => {
    if (!payload) return null;
    try {
      return buildMatrix(payload, options.level);
    } catch (e) {
      // Overlong payloads exceed even version 40.
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [payload, options.level]);

  useEffect(() => {
    if (matrix) setError(null);
  }, [matrix]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !matrix) return;
    drawMatrix(canvas, matrix, options, logo?.bitmap);
  }, [matrix, options, logo]);

  const pickLogo = useCallback(
    async (paths: string[]) => {
      const path = paths[0];
      if (!path) return;
      try {
        const bitmap = await loadBitmap(await ctx.files.read(path));
        setLogo({ path, bitmap });
        // A logo eats modules; H is the only level that reliably survives it.
        if (options.logoRatio === 0) update({ logoRatio: 0.2, level: 'H' });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [ctx.files, options.logoRatio, update],
  );

  const save = async () => {
    if (!matrix) return;
    setError(null);
    setSaved(null);

    try {
      const folder = await ctx.files.pickDirectory('Where to save the QR code');
      if (!folder) return;

      const name = `${options.fileName.trim() || 'qrcode'}.${options.exportFormat}`;
      const path = await ctx.files.join(folder, name);

      if (options.exportFormat === 'svg') {
        await ctx.files.write(path, new TextEncoder().encode(toSvg(matrix, options)));
      } else {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Nothing rendered yet');
        await ctx.files.write(path, await blobToBytes(await canvasToBlob(canvas, 'png')));
      }

      setSaved(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <PanelLayout
      options={
        <>
          <SelectField
            label="Content"
            value={options.kind}
            onChange={(kind) => update({ kind })}
            options={KIND_OPTIONS}
          />

          {options.kind === 'text' && (
            <Row label="Text">
              <Textarea
                value={options.text}
                onChange={(e) => update({ text: e.target.value })}
                className="min-h-24 font-mono text-sm"
              />
            </Row>
          )}

          {options.kind === 'url' && (
            <TextField
              label="URL"
              hint="https:// is added if you leave the scheme out."
              placeholder="example.com"
              value={options.url}
              onChange={(url) => update({ url })}
            />
          )}

          {options.kind === 'wifi' && (
            <>
              <TextField label="Network name (SSID)" value={options.wifiSsid} onChange={(wifiSsid) => update({ wifiSsid })} />
              <SelectField
                label="Security"
                value={options.wifiSecurity}
                onChange={(wifiSecurity) => update({ wifiSecurity })}
                options={[
                  { value: 'WPA' as const, label: 'WPA / WPA2 / WPA3' },
                  { value: 'WEP' as const, label: 'WEP' },
                  { value: 'nopass' as const, label: 'Open (no password)' },
                ]}
              />
              {options.wifiSecurity !== 'nopass' && (
                <TextField label="Password" value={options.wifiPassword} onChange={(wifiPassword) => update({ wifiPassword })} />
              )}
              <Toggle label="Hidden network" checked={options.wifiHidden} onChange={(wifiHidden) => update({ wifiHidden })} />
            </>
          )}

          {options.kind === 'email' && (
            <>
              <TextField label="To" value={options.emailTo} onChange={(emailTo) => update({ emailTo })} />
              <TextField label="Subject" value={options.emailSubject} onChange={(emailSubject) => update({ emailSubject })} />
              <Row label="Body">
                <Textarea
                  value={options.emailBody}
                  onChange={(e) => update({ emailBody: e.target.value })}
                  className="min-h-20 text-sm"
                />
              </Row>
            </>
          )}

          {options.kind === 'phone' && (
            <TextField label="Phone number" value={options.phone} onChange={(phone) => update({ phone })} />
          )}

          {options.kind === 'sms' && (
            <>
              <TextField label="Number" value={options.smsNumber} onChange={(smsNumber) => update({ smsNumber })} />
              <TextField label="Message" value={options.smsMessage} onChange={(smsMessage) => update({ smsMessage })} />
            </>
          )}

          {options.kind === 'vcard' && (
            <>
              <TextField label="Full name" value={options.vcardName} onChange={(vcardName) => update({ vcardName })} />
              <TextField label="Organisation" value={options.vcardOrg} onChange={(vcardOrg) => update({ vcardOrg })} />
              <TextField label="Job title" value={options.vcardTitle} onChange={(vcardTitle) => update({ vcardTitle })} />
              <TextField label="Phone" value={options.vcardPhone} onChange={(vcardPhone) => update({ vcardPhone })} />
              <TextField label="Email" value={options.vcardEmail} onChange={(vcardEmail) => update({ vcardEmail })} />
              <TextField label="Website" value={options.vcardUrl} onChange={(vcardUrl) => update({ vcardUrl })} />
            </>
          )}

          <SelectField
            label="Error correction"
            value={options.level}
            onChange={(level) => update({ level })}
            options={LEVEL_OPTIONS}
          />

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Module size"
              min={1}
              max={40}
              suffix="px"
              value={options.moduleSize}
              onChange={(moduleSize) => update({ moduleSize })}
            />
            <NumberField
              label="Quiet zone"
              hint="4 is the spec minimum."
              min={0}
              max={16}
              value={options.margin}
              onChange={(margin) => update({ margin })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <TextField label="Foreground" mono value={options.foreground} onChange={(foreground) => update({ foreground })} />
            <TextField label="Background" mono value={options.background} onChange={(background) => update({ background })} />
          </div>

          <Toggle label="Rounded modules" checked={options.rounded} onChange={(rounded) => update({ rounded })} />

          <Row label="Center logo" hint="Raise error correction to H when using one.">
            {logo ? (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{logo.path}</code>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => setLogo(null)}>
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <FileDropZone
                files={ctx.files}
                onFiles={pickLogo}
                pickOptions={{ title: 'Pick a logo', filters: IMAGE_FILTERS }}
                label="Drop a logo (optional)"
                className="py-4"
              />
            )}
          </Row>

          {logo && (
            <NumberField
              label="Logo size"
              hint="Above ~25% the code stops scanning reliably."
              min={5}
              max={30}
              suffix="%"
              value={Math.round(options.logoRatio * 100)}
              onChange={(value) => update({ logoRatio: value / 100 })}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Export as"
              value={options.exportFormat}
              onChange={(exportFormat) => update({ exportFormat })}
              options={[
                { value: 'png' as const, label: 'PNG' },
                { value: 'svg' as const, label: 'SVG (vector)' },
              ]}
            />
            <TextField label="File name" value={options.fileName} onChange={(fileName) => update({ fileName })} />
          </div>

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <>
          {!payload ? (
            <p className="text-sm text-muted-foreground">Fill in the content on the left.</p>
          ) : (
            <>
              <div className="flex justify-center rounded-md border bg-muted/30 p-6">
                <canvas ref={canvasRef} className="max-w-full" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={save} disabled={!matrix}>
                  <Download className="size-4" />
                  Save {options.exportFormat.toUpperCase()}
                </Button>
                <Button variant="outline" onClick={() => ctx.copy(payload)}>
                  Copy payload
                </Button>
                {matrix && (
                  <span className="text-xs text-muted-foreground">
                    {matrix.size} × {matrix.size} modules
                  </span>
                )}
              </div>

              <Row label="Encoded payload">
                <pre className="max-h-32 overflow-auto rounded-md border p-3 font-mono text-xs">
                  {payload}
                </pre>
              </Row>
            </>
          )}

          {saved && (
            <div className="flex items-center gap-2 text-xs">
              <code className="min-w-0 flex-1 truncate font-mono">{saved}</code>
              <Button size="sm" variant="outline" onClick={() => ctx.files.reveal(saved)}>
                Show in folder
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      }
    />
  );
}
