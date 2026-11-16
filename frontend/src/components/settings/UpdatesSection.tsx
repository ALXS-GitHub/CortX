import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Check, Download, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Section } from '@/components/settings/SettingsPrimitives';
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
export function UpdatesSection() {
  const { phase, update, error, lastChecked, checkForUpdate, install } = useUpdateStore();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';
  const canInstall = !!update && !busy;

  return (
    <Section
      title="Updates"
      icon={Download}
      description="CortX checks for a new version at startup. Check again or install it from here at any time."
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Installed</span>
        <Badge variant="secondary" className="font-mono">{version ? `v${version}` : '…'}</Badge>
        {phase === 'upToDate' && (
          <Badge variant="success">
            <Check /> Up to date
          </Badge>
        )}
        {update && (
          <Badge variant="default" className="font-mono">
            v{update.version} available
          </Badge>
        )}
        {lastChecked && (
          <span className="text-faint">
            · checked at {new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void checkForUpdate()} disabled={busy}>
          {phase === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {phase === 'checking' ? 'Checking…' : 'Check for updates'}
        </Button>
        {update && (
          <Button onClick={() => void install()} disabled={!canInstall}>
            <Download />
            {phase === 'downloading' || phase === 'installing'
              ? 'Installing…'
              : `Download and install v${update.version}`}
          </Button>
        )}
      </div>

      <UpdateProgress />
      {phase === 'error' && error && <p className="text-xs text-destructive">{error}</p>}
    </Section>
  );
}
