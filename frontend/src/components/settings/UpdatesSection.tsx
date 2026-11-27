import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Check, Download, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Section, SectionBody, SettingRow } from '@/components/settings/SettingsPrimitives';
import { updateProgress, useUpdateStore } from '@/stores/updateStore';

export const UPDATES_SECTION_KEYWORDS = 'updates update version new release download install upgrade check';

/** The download bar of an update in progress (nothing otherwise). Shared with the startup dialog. */
export function UpdateProgress() {
  const { phase, downloaded, total } = useUpdateStore();
  if (phase !== 'downloading' && phase !== 'installing') return null;
  const pct = phase === 'installing' ? 100 : updateProgress(downloaded, total);
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <RefreshCw className="size-4 animate-spin text-primary" />
        {phase === 'installing' ? 'Installing — CortX restarts on its own…' : 'Downloading the update…'}
      </div>
      <Progress value={pct ?? 0} className="h-2" />
      <p className="text-xs tabular-nums text-faint">
        {pct === null ? `${mb(downloaded)} MB` : `${Math.round(pct)}%${total > 0 ? ` · ${mb(downloaded)} / ${mb(total)} MB` : ''}`}
      </p>
    </div>
  );
}

/** Settings card: this build's version, a check on demand, and the install of a newer one. */
export function UpdatesSection({ id }: { id?: string }) {
  const { phase, update, error, lastChecked, checkForUpdate, install } = useUpdateStore();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';
  const canInstall = !!update && !busy;
  const checked = lastChecked
    ? `Checked at ${new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
    : 'CortX checks for a new version at startup.';

  return (
    <Section id={id} title="Updates">
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            CortX <span className="font-mono text-xs text-muted-foreground">{version ? `v${version}` : '…'}</span>
            {phase === 'upToDate' && (
              <Badge variant="success">
                <Check /> Up to date
              </Badge>
            )}
            {update && <Badge variant="default">v{update.version} available</Badge>}
          </span>
        }
        hint={checked}
      >
        <Button variant="outline" size="sm" onClick={() => void checkForUpdate()} disabled={busy}>
          {phase === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {phase === 'checking' ? 'Checking…' : 'Check for updates'}
        </Button>
      </SettingRow>
      {update && (
        <SettingRow label={`Install v${update.version}`} hint="Downloads the update, then CortX restarts on its own.">
          <Button size="sm" onClick={() => void install()} disabled={!canInstall}>
            <Download />
            {phase === 'downloading' || phase === 'installing' ? 'Installing…' : 'Download and install'}
          </Button>
        </SettingRow>
      )}
      {(phase === 'downloading' || phase === 'installing') && (
        <SectionBody>
          <UpdateProgress />
        </SectionBody>
      )}
      {phase === 'error' && error && (
        <SectionBody>
          <p className="text-xs text-destructive">{error}</p>
        </SectionBody>
      )}
    </Section>
  );
}
