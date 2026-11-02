import { ActivityTabs } from '@/components/ble/ActivityTabs';
import { HAModeDetector } from '@/components/ha/HAModeDetector';

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
      <HAModeDetector />

      <details className="mt-4 rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity log
        </summary>
        <div className="border-t p-3">
          <ActivityTabs />
        </div>
      </details>
    </div>
  );
}
