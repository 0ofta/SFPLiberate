"use client";
/**
 * Settings card for how the app reaches the SFP Wizard: the connection mode (saved in
 * localStorage, used by the Dashboard) and a reset of the remembered BLE profile.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ConnectionMode } from '@/lib/ble/types';
import { loadConnectionMode, saveConnectionMode } from '@/lib/ble/connection-mode';
import { clearActiveProfile, loadActiveProfile } from '@/lib/ble/profile';
import { ConnectionModeSelector } from '@/components/ble/ConnectionModeSelector';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ConnectionSettings() {
  const [mode, setMode] = useState<ConnectionMode>('auto');
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    setMode(loadConnectionMode());
    setHasProfile(loadActiveProfile() !== null);
  }, []);

  const onModeChange = (next: ConnectionMode) => {
    setMode(next);
    saveConnectionMode(next);
    toast.success('Connection mode saved');
  };

  const onForget = () => {
    clearActiveProfile();
    setHasProfile(false);
    toast.success('Saved device forgotten', { description: 'The next Connect opens the device chooser.' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection</CardTitle>
        <CardDescription>How the Dashboard reaches the SFP Wizard.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Connection mode</p>
          <ConnectionModeSelector value={mode} onChange={onModeChange} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Saved SFP Wizard</p>
            <p className="text-sm text-muted-foreground">
              {hasProfile ? 'The device and its Bluetooth profile are remembered.' : 'No device remembered yet.'}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={!hasProfile}>Forget device</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Forget the saved SFP Wizard?</AlertDialogTitle>
                <AlertDialogDescription>
                  The next Connect opens the device chooser again. Use this after a firmware update or when you switch to
                  another Wizard. Your module library is not touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onForget}>Forget</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
