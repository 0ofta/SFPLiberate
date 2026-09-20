'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { parseSFPIdentification, parseSFPDiagnostics } from '@/lib/sfp/parser';

type SfpDataViewerProps = {
  eepromData: ArrayBuffer | null;
  loading?: boolean;
  emptyMessage?: string;
};

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium">{value ?? '—'}</span>
    </div>
  );
}

/**
 * Displays the same identification and live diagnostic (DDM) data the SFP
 * Wizard's own screen shows for an inserted module - vendor/model/serial and
 * temperature/voltage/bias current/optical power - for either a freshly-read
 * live device or a module stored in the local library.
 */
export function SfpDataViewer({ eepromData, loading, emptyMessage }: SfpDataViewerProps) {
  if (loading) {
    return <p className="text-sm text-neutral-500">Loading module data…</p>;
  }

  if (!eepromData) {
    return <p className="text-sm text-neutral-500">{emptyMessage ?? 'No EEPROM data available.'}</p>;
  }

  const id = parseSFPIdentification(eepromData);
  const ddm = parseSFPDiagnostics(eepromData);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">Identification</h3>
          {id.ddmSupported ? (
            <Badge variant="secondary">DDM supported</Badge>
          ) : (
            <Badge variant="outline">No DDM</Badge>
          )}
        </div>
        <div className="rounded-md border p-3">
          <Field label="Vendor" value={id.vendor} />
          <Field label="Model / Part #" value={id.model} />
          <Field label="Serial" value={id.serial} />
          <Field label="Revision" value={id.revision} />
          <Field label="Date Code" value={id.dateCode} />
          <Separator className="my-2" />
          <Field label="Connector" value={id.connectorType} />
          <Field label="Speed" value={id.nominalBitRateMbps ? `${id.nominalBitRateMbps} Mbps` : null} />
          <Field label="Wavelength" value={id.wavelengthNm ? `${id.wavelengthNm} nm` : null} />
          <Field label="Frequency" value={id.frequencyTHz ? `${id.frequencyTHz.toFixed(2)} THz` : null} />
          {id.linkLengths.length > 0 ? (
            id.linkLengths.map((l) => <Field key={l.media} label={`Distance (${l.media})`} value={l.distance} />)
          ) : (
            <Field label="Distance" value={null} />
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Live Diagnostics (DDM)</h3>
        <div className="rounded-md border p-3">
          {ddm ? (
            <>
              <Field label="Temperature" value={`${ddm.temperatureC.toFixed(1)} °C`} />
              <Field label="Supply Voltage" value={`${ddm.vccVolts.toFixed(3)} V`} />
              <Field label="TX Bias Current" value={`${ddm.txBiasMa.toFixed(2)} mA`} />
              <Field
                label="TX Power"
                value={ddm.txPowerDbm !== null ? `${ddm.txPowerDbm.toFixed(2)} dBm (${ddm.txPowerMw.toFixed(4)} mW)` : '0 mW (laser off)'}
              />
              <Field
                label="RX Power"
                value={ddm.rxPowerDbm !== null ? `${ddm.rxPowerDbm.toFixed(2)} dBm (${ddm.rxPowerMw.toFixed(4)} mW)` : '0 mW (no signal)'}
              />
            </>
          ) : (
            <p className="text-sm text-neutral-500">
              {id.ddmSupported
                ? 'This capture does not include the diagnostic monitoring page (A2h).'
                : 'This module does not support digital diagnostics monitoring, or uses external calibration (not supported).'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
