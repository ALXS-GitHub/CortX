import { useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { Download, RefreshCw } from 'lucide-react';

export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  useEffect(() => {
    // Check for updates on startup (with a small delay to not block the UI)
    const checkForUpdates = async () => {
      try {
        const updateAvailable = await check();
        if (updateAvailable) {
          setUpdate(updateAvailable);
          setShowDialog(true);
        }
      } catch (error) {
        console.error('Failed to check for updates:', error);
      }
    };

    const timer = setTimeout(checkForUpdates, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async () => {
    if (!update) return;

    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            setTotalBytes(event.data.contentLength || 0);
            break;
          case 'Progress':
            setDownloadedBytes((prev) => prev + event.data.chunkLength);
            if (totalBytes > 0) {
              setDownloadProgress((downloadedBytes / totalBytes) * 100);
            }
            break;
          case 'Finished':
            setDownloadProgress(100);
            break;
        }
      });

      // Relaunch the app after installation
      await relaunch();
    } catch (error) {
      console.error('Failed to install update:', error);
      setIsDownloading(false);
    }
  };

  const handleSkip = () => {
    setShowDialog(false);
  };

  if (!update) return null;

  return (
    <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Download className="size-5" />
            Update Available
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                A new version of Cortx is available: <strong>v{update.version}</strong>
              </p>
              {update.body && (
                <div className="mt-2 p-3 bg-muted rounded-md text-sm max-h-32 overflow-y-auto">
                  <p className="font-medium mb-1">Release Notes:</p>
                  <p className="whitespace-pre-wrap">{update.body}</p>
                </div>
              )}
              {isDownloading && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="size-4 animate-spin" />
                    <span className="text-sm">Downloading update...</span>
                  </div>
                  <Progress value={downloadProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {Math.round(downloadProgress)}% complete
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleSkip} disabled={isDownloading}>
            Later
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleUpdate} disabled={isDownloading}>
            {isDownloading ? 'Installing...' : 'Update Now'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
