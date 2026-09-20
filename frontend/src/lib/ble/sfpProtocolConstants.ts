/**
 * SFP Wizard characteristic UUIDs for firmware speaking the "binme" binary
 * envelope protocol (confirmed on v1.1.3; likely v1.1.0+). Firmware v1.0.10
 * used a different plain-text protocol, documented separately in
 * docs/BLE_API_SPECIFICATION.md.
 *
 * Reverse-engineered from the open-source sfpw-tool project
 * (https://github.com/vitaminmoo/sfpw-tool).
 */
export const SFP_WRITE_CHAR_UUID = '9280f26c-a56f-43ea-b769-d5d732e1ac67';
/** Plain-text GATT read only. Returns {"id","fwv","apiVersion","voltage","level"} as raw JSON, no binme envelope. */
export const SFP_DEVICE_INFO_CHAR_UUID = 'dc272a22-43f2-416b-8fa5-63a071542fac';
/** The actual API response notify channel. NOT dc272a22, despite that being the more obviously-named one. */
export const SFP_API_NOTIFY_CHAR_UUID = 'd587c47f-ac6e-4388-a31c-e6cd380ba043';
