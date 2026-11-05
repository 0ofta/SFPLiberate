# Next.js File Structure & Migration Map

This document maps the current vanilla JavaScript frontend to the new Next.js structure.

## 📁 Current Structure (Vanilla JS)

```
frontend/
├── Dockerfile (NGINX-based)
├── nginx.conf (reverse proxy config)
├── index.html (250 lines)
├── style.css (400 lines)
├── script.js (1264 lines - monolithic)
└── ble-proxy-client.js (BLE proxy WebSocket client)
```

## 📁 New Structure (Next.js)

```
frontend-nextjs/
├── app/                                    # Next.js App Router
│   ├── layout.tsx                          # Root layout (theme, navigation)
│   ├── page.tsx                            # Home page (connection dashboard)
│   ├── modules/
│   │   ├── page.tsx                        # Module library (DataTable)
│   │   └── [id]/
│   │       └── page.tsx                    # Module detail view
│   ├── community/
│   │   └── page.tsx                        # Community modules browser
│   └── login/                              # Appwrite mode only
│       └── page.tsx                        # Login page
│
├── components/
│   ├── ui/                                 # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── toast.tsx
│   │   ├── table.tsx
│   │   ├── command.tsx
│   │   └── [25+ more shadcn components]
│   │
│   ├── ble/                                # BLE-specific components
│   │   ├── ConnectionStatus.tsx            # BLE/SFP status indicators
│   │   ├── ConnectionModeSelector.tsx      # Auto/Direct/Proxy selector
│   │   ├── ConnectButton.tsx               # Main connect button
│   │   ├── DeviceDiscovery.tsx             # Scan & discovery UI
│   │   ├── ProfileManager.tsx              # UUID profile management
│   │   ├── ReadSfpButton.tsx               # Read EEPROM button
│   │   ├── LiveSfpData.tsx                 # Live data display card
│   │   └── DeviceInfo.tsx                  # Firmware, battery, etc.
│   │
│   ├── modules/                            # Module library components
│   │   ├── ModuleTable.tsx                 # DataTable (TanStack)
│   │   ├── ModuleDetail.tsx                # Detail view with tabs
│   │   ├── WriteButton.tsx                 # Write with safety dialog
│   │   ├── CommunityUploadDialog.tsx       # Upload to community
│   │   ├── CommunityTable.tsx              # Community browser
│   │   └── ImportExport.tsx                # Import/export controls
│   │
│   ├── layout/                             # Layout components
│   │   ├── Header.tsx                      # App header with nav
│   │   ├── Footer.tsx                      # Footer with log toggle
│   │   ├── Navigation.tsx                  # Nav menu
│   │   └── ThemeToggle.tsx                 # Dark/light/system
│   │
│   └── auth/                               # Appwrite mode only
│       ├── LoginForm.tsx
│       └── UserMenu.tsx
│
├── lib/
│   ├── api/                                # API client layer
│   │   ├── client.ts                       # Base fetch wrapper
│   │   ├── modules.ts                      # Module API methods
│   │   ├── ble.ts                          # BLE API methods
│   │   └── types.ts                        # API response types
│   │
│   ├── ble/                                # BLE service layer
│   │   ├── types.ts                        # BLE types (Profile, Status, etc.)
│   │   ├── direct.ts                       # Web Bluetooth API wrapper
│   │   ├── proxy.ts                        # WebSocket proxy client (migrated)
│   │   ├── manager.ts                      # Unified BLE manager
│   │   ├── parser.ts                       # SFF-8472 EEPROM parser
│   │   └── statusMonitor.ts                # Periodic status polling
│   │
│   ├── appwrite/                           # Appwrite mode only
│   │   ├── client.ts                       # Appwrite SDK setup
│   │   └── auth.ts                         # Auth methods
│   │
│   └── utils.ts                            # Utility functions
│
├── hooks/
│   ├── useBle.ts                           # BLE connection hook
│   ├── useModules.ts                       # Module library hook (React Query)
│   ├── useLogger.ts                        # Logging hook
│   └── useProfile.ts                       # Profile management hook
│
├── types/
│   ├── ble.ts                              # BLE type definitions
│   ├── module.ts                           # Module type definitions
│   └── global.d.ts                         # Global type augmentations
│
├── styles/
│   └── globals.css                         # Global Tailwind styles
│
├── public/
│   ├── favicon.ico
│   └── [static assets]
│
├── tests/
│   ├── unit/                               # Jest + RTL tests
│   │   ├── api.test.ts
│   │   ├── parser.test.ts
│   │   └── components/
│   │       ├── ConnectionStatus.test.tsx
│   │       └── ModuleTable.test.tsx
│   │
│   ├── e2e/                                # Playwright tests
│   │   ├── connection.spec.ts
│   │   ├── read-write.spec.ts
│   │   └── library.spec.ts
│   │
│   └── fixtures/                           # Test data
│       ├── mock-eeprom.bin
│       └── mock-modules.json
│
├── Dockerfile                              # Multi-stage build
├── next.config.ts                          # Next.js config (standalone/export)
├── tailwind.config.ts                      # Tailwind config
├── tsconfig.json                           # TypeScript config (strict mode)
├── package.json                            # Dependencies
├── .env.example                            # Example environment variables
├── .env.local                              # Local development (gitignored)
├── middleware.ts                           # Appwrite auth middleware
└── README.md                               # Developer guide
```

## 🔄 Migration Mapping

### JavaScript → TypeScript Modules

| Current File | New Location | Notes |
|--------------|-------------|-------|
| `script.js` (lines 1-50) | `lib/ble/types.ts` | Type definitions |
| `script.js` (lines 51-400) | `lib/ble/direct.ts` | Web Bluetooth logic |
| `script.js` (lines 401-600) | `lib/ble/manager.ts` | Connection management |
| `script.js` (lines 601-700) | `lib/ble/parser.ts` | SFF-8472 parser |
| `script.js` (lines 701-900) | `lib/ble/proxy.ts` | BLE proxy client |
| `script.js` (lines 901-1100) | `lib/api/modules.ts` | API calls |
| `script.js` (lines 1101-1264) | Components split | UI logic → React components |
| `ble-proxy-client.js` | `lib/ble/proxy.ts` | TypeScript rewrite |

### HTML → React Components

| Current HTML Element | New Component | File |
|---------------------|---------------|------|
| `<header>` | `<Header />` | `components/layout/Header.tsx` |
| `<main class="container">` | Layout wrapper | `app/layout.tsx` |
| Connection status grid | `<ConnectionStatus />` | `components/ble/ConnectionStatus.tsx` |
| Connection mode selector | `<ConnectionModeSelector />` | `components/ble/ConnectionModeSelector.tsx` |
| Read SFP button | `<ReadSfpButton />` | `components/ble/ReadSfpButton.tsx` |
| Live data area | `<LiveSfpData />` | `components/ble/LiveSfpData.tsx` |
| Module list `<ul>` | `<ModuleTable />` | `components/modules/ModuleTable.tsx` |
| Log console `<div>` | `<LogDrawer />` | `components/ui/LogDrawer.tsx` |
| Discovery UI | `<DeviceDiscovery />` | `components/ble/DeviceDiscovery.tsx` |

### CSS → Tailwind/shadcn

| Current CSS | New Approach | Example |
|------------|-------------|---------|
| Custom CSS classes | Tailwind utility classes | `class="flex items-center gap-4"` |
| CSS variables (theme) | shadcn theme system | `bg-background text-foreground` |
| Status indicators | shadcn Badge | `<Badge variant="success">Connected</Badge>` |
| Cards | shadcn Card | `<Card><CardHeader>...</CardHeader></Card>` |
| Buttons | shadcn Button | `<Button variant="default" size="lg">Connect</Button>` |

## 📦 Dependencies

### Old Stack
```json
{
  "devDependencies": {},
  "dependencies": {}
}
```
(No package.json - vanilla JS served by NGINX)

### New Stack
```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@radix-ui/react-*": "latest",
    "@tanstack/react-table": "^8.20.0",
    "lucide-react": "latest",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "appwrite": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "eslint": "^9.0.0",
    "@next/eslint-plugin-next": "^16.0.0",
    "prettier": "^3.3.0",
    "jest": "^29.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "playwright": "^1.48.0"
  }
}
```

## 🔧 Configuration Files

### New Configuration Files

```
frontend-nextjs/
├── next.config.ts              # Next.js configuration
├── tsconfig.json               # TypeScript strict mode
├── tailwind.config.ts          # Tailwind CSS 4
├── postcss.config.mjs          # PostCSS (Tailwind)
├── eslint.config.mjs           # ESLint 9 (flat config)
├── prettier.config.js          # Prettier
├── jest.config.js              # Jest testing
├── playwright.config.ts        # Playwright E2E
├── .env.example                # Environment variables template
├── .env.local                  # Local development (gitignored)
├── .dockerignore               # Docker build exclusions
├── components.json             # shadcn/ui config
└── appwrite.json               # Appwrite project config (Appwrite mode)
```

### Environment Variables

```bash
# .env.example (Standalone Mode)
DEPLOYMENT_MODE=standalone
BACKEND_URL=http://backend
NEXT_PUBLIC_API_URL=/api
NODE_ENV=production

# .env.example (Appwrite Mode)
DEPLOYMENT_MODE=appwrite
NEXT_PUBLIC_API_URL=https://api.sfpvault.com
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
NODE_ENV=production
```

## 📊 Size Comparison

### Current Frontend
```
index.html:             250 lines
style.css:              400 lines
script.js:            1,264 lines
ble-proxy-client.js:   ~200 lines (estimated)
-----------------------------------
TOTAL:               ~2,114 lines
```

### New Frontend (Estimated)
```
Components:          ~3,500 lines (30+ components × ~100 lines avg)
Services/Lib:        ~2,000 lines (API, BLE, utils)
Types:                 ~500 lines
Tests:               ~2,000 lines
Config:                ~300 lines
-----------------------------------
TOTAL (code):        ~8,300 lines (4x increase due to TypeScript, tests, types)
TOTAL (production):  ~6,300 lines (excluding tests)
```

**Note:** While line count increases, the code is:
- **More maintainable** (smaller, focused files)
- **Type-safe** (TypeScript catches errors at compile time)
- **Testable** (unit + E2E tests)
- **Reusable** (component-based architecture)

## 🚀 Build Outputs

### Standalone Mode (Docker)
```
.next/standalone/           # Next.js standalone server
├── server.js               # Entrypoint
├── .next/
│   ├── static/             # Static assets (CSS, JS chunks)
│   └── server/             # Server-side bundles
└── public/                 # Public assets
```

### Appwrite Mode (Static Export)
```
out/                        # Static HTML/JS/CSS
├── index.html
├── modules.html
├── community.html
├── login.html
├── _next/
│   ├── static/
│   └── chunks/
└── assets/
```

## 📝 Notes

1. **No Breaking Changes for Backend**: FastAPI remains unchanged; only CORS config added
2. **LocalStorage Keys**: Maintain compatibility with existing keys (`sfpActiveProfile`, `proxyAdapter`)
3. **BLE UUIDs**: Same UUIDs used; no changes needed
4. **API Endpoints**: All existing `/api/v1/*` endpoints remain the same
5. **Docker Volume**: `backend_data` volume unchanged; database persists across rewrite

---

**Last Updated:** 2025-11-02
**Related Docs:**
- [Epic Plan](NEXTJS_REWRITE_EPIC.md)
- [Quick Summary](NEXTJS_REWRITE_SUMMARY.md)
