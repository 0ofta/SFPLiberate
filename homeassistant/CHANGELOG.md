# Changelog

All notable changes to the SFPLiberate Home Assistant Add-On will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-08-18

### Fixed
- CI no longer publishes only a `-ci`-suffixed image tag on pushes to `main`;
  it now publishes the plain version tag that Supervisor actually pulls
  (config.yaml's `version:` had no matching published image, so every
  install/update 404'd - see #118, #122)
- Frontend build no longer fails on the non-existent `appwrite` `RealtimeSubscription`
  type export, which broke `next build` for both the standalone Docker image
  and this add-on (see #117)
- Web Bluetooth device discovery no longer silently fails to find Ubiquiti's
  own `UACC-SFP-Wizard` hardware, whose name doesn't start with `SFP` (see #122)

### Changed
- Removed the `image:` key from config.yaml so Supervisor always builds the
  add-on locally from this repo's Dockerfile instead of pulling a prebuilt
  image from a registry - this repo no longer depends on any CI publish
  step succeeding for the add-on to install
- Repointed repository/image metadata (config.yaml, build.yaml, Dockerfile
  labels, repository.json, README badge) from `josiah-nelson/SFPLiberate`
  to this fork so the add-on's own self-description is accurate

## [Unreleased]

### Added
- Initial Home Assistant Add-On implementation
- Automatic Bluetooth device discovery via HA API
- Single-click connection flow
- Auto-discovery of ESPHome Bluetooth proxies
- Support for HA host Bluetooth adapter
- Pattern-based device filtering
- Ingress support for web UI
- Automatic backup integration
- Multi-architecture support (aarch64, amd64, armhf, armv7)

### Changed
- Backend now uses HomeAssistantBluetoothClient instead of ESPHome mDNS discovery
- Frontend simplified with auto-discovery UI
- Database location moved to `/config/sfpliberate/` for backup integration

### Fixed
- N/A (initial release)

## [1.0.0] - TBD

### Added
- First stable release of Home Assistant Add-On
- All features from standalone Docker deployment
- Simplified setup and configuration
- Comprehensive documentation

---

## Version History

**Pre-release versions:**
- Development versions not tracked in this changelog
- See git commit history for detailed development changes

**Standalone Docker:**
- See main repository CHANGELOG for standalone deployment versions
- Add-on versions are independent of standalone versions
