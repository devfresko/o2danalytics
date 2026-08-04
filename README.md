# Fresko O2D Analytics

**Order-to-Delivery Operations Dashboard** — built on Google Apps Script + GitHub Pages.

> Role-based PWA for Fresko's operations team. Management gets full CRUD. Field users get read access + pipeline status updates. Zero server cost. Installable as Android/iOS app.

---

## Live URL

```
https://devfresko.github.io/o2danalytics
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS SPA, GitHub Pages |
| Backend | Google Apps Script (JSONP API) |
| Database | Google Sheets (4 workbooks) |
| Auth | Email + Password via `Users` sheet |
| Charts | Chart.js 4.4 |
| Icons | Font Awesome 6 |
| PWA | Web App Manifest + Service Worker |

---

## Google Sheets

| Workbook | Sheet ID | Contains |
|---|---|---|
| O2D | `1_wTci2P2XEOowRv1g3lSelErIFf9-5oywa45b_yACZM` | Orders, Order_Details, Recieved_item, Returned_Item, PDFs |
| Purchase | `15MBItREzYwQaDesOjZF2jUUJHBwp5lFzSzWFIiRUjFo` | Indent, Purchased_Items, Reimbursement |
| Dump | `14WfQPSqKBntkuvf30aYlldZGCevzYMFsT6dlNTnygo0` | Dump |
| Masters | `1xlwtEXXlFlr8YxCUV_Ii_GeRy7kyAtYAsRA9rbY4-6w` | Customer, Location, Items, Vendor, **Users** |

---

## Files

```
o2danalytics/
├── index.html        ← Full SPA shell (login, sidebar, drawer, all views)
├── app.js            ← All view renders + CRUD forms + auth logic
├── apiconfig.js      ← GAS_URL + APP_CONFIG (edit before deploying)
├── Code.gs           ← Google Apps Script backend (deploy as Web App)
├── manifest.json     ← PWA manifest
├── sw.js             ← Service worker (offline shell caching)
├── icon-192.png      ← PWA icon
├── icon-512.png      ← PWA icon
└── README.md         ← This file
```

---

## Setup (First Time)

### Step 1 — Create the `Users` sheet

Open the **Masters workbook** → Add a new sheet named exactly `Users` → Add these columns in Row 1:

| A | B | C | D |
|---|---|---|---|
| Email | Password | Name | Role |

Add your users below. Role must be `management` or `user`.

**Example:**

| Email | Password | Name | Role |
|---|---|---|---|
| admin@fresko.co.in | fresko123 | Admin | management |
| delivery@fresko.co.in | pass456 | Ravi Kumar | user |

---

### Step 2 — Deploy Code.gs

1. Go to [script.google.com](https://script.google.com)
2. Create a new project → paste `Code.gs` content
3. Click **Deploy → New Deployment**
4. Type: **Web App**
5. Execute as: **Me**
6. Who has access: **Anyone**
7. Click **Deploy** → Copy the Web App URL

---

### Step 3 — Paste URL in apiconfig.js

Open `apiconfig.js` and replace the placeholder:

```js
var GAS_URL = 'https://script.google.com/macros/s/YOUR_ID_HERE/exec';

var APP_CONFIG = {
  autoRefreshMs: 5 * 60 * 1000,   // Auto-refresh every 5 minutes
  apiTimeoutMs:  28000,            // API timeout in ms
  defaultView:   'kanban',         // Default view on load
  drivePhotoBase: ''               // Google Drive photo base URL (optional)
};
```

---

### Step 4 — Push to GitHub

```bash
git add .
git commit -m "Deploy O2D Analytics"
git push origin main
```

GitHub Pages auto-deploys from `main` branch. Wait ~60 seconds, then visit the live URL.

---

## Role Permissions

| Action | `user` | `management` |
|---|---|---|
| View all orders, charts, gallery | ✅ | ✅ |
| Advance pipeline status | ✅ | ✅ |
| Create / Edit / Delete orders | ❌ | ✅ |
| Create / Edit / Delete indents | ❌ | ✅ |
| Create / Edit / Delete purchased items | ❌ | ✅ |
| Log dump entries | ❌ | ✅ |
| Masters CRUD (Customer/Location/Item/Vendor) | ❌ | ✅ |
| See "Masters" nav tab | ❌ | ✅ |

---

## Views

| View | Description |
|---|---|
| **Kanban** | 6-column pipeline board (Pending → Invoiced), filterable |
| **Table** | Sortable, paginated orders table with inline Edit/Delete (management) |
| **Feed** | Chronological list grouped by Expected Delivery Date |
| **Charts & KPIs** | 12 KPI cards + 6 Chart.js charts (status, daily volume, indent vs purchased, delivery boy, crates, top customers) |
| **Calendar** | Month grid with colored dots per pipeline status, click to see day's orders |
| **Timeline** | Step-by-step pipeline view for one order — planned vs actual timestamps |
| **Gallery** | Loading photos + Delivery photos + PDFs |
| **Pivot** | Row/Column matrix — Customer × Status, Delivery Boy × Status, etc. |
| **Map** | Location cards with invoiced % progress bars |
| **Customer Tree** | Drill-down: Customer → Orders → Line Items |
| **Purchase** | Vendor spend, purchased items with cat/subcat filter, indents, dump log |
| **Masters** | Full CRUD for Customer, Location, Items, Vendor (management only) |

---

## Pipeline Steps

```
Pending → WH Loaded → Delivered → DEO Collected → DEO Approved → Invoiced
```

Status is **derived automatically** from step timestamps — not stored in a separate column.

| Step | Sheet Column |
|---|---|
| WH Loaded | `_step1_actual` |
| Delivered | `_step2_actual` |
| DEO Collected | `_step4_actual` |
| DEO Approved | `_step5_actual` |
| Invoiced | `_step6_actual` |

---

## Masters UUID Resolution

All foreign keys in Orders, Order_Details, Purchased_Items are UUIDs. The backend resolves them on every API call:

| UUID Field | Resolves To | From Sheet |
|---|---|---|
| `Customer Name` | Company Name | Customer |
| `Delivery Location` | Location Name | Location |
| `Item Name` (in details) | Item Name | Items |
| `Vendor` (in purchases) | Company Name | Vendor |

**No UUID ever appears in the UI.** Only human-readable names are shown.

---

## CRUD Operations

### Orders
- **Create** → Management clicks "New Order" → Drawer opens → Customer dropdown (resolved names) → Location filtered by customer → EDD, Warehouse, Vehicle, Crates, Invoice
- **Edit** → Click pencil icon on any row → Same drawer with pre-filled values
- **Delete** → Click trash icon → Confirm dialog → Permanent delete

### Indents
- Create/Edit/Delete from Purchase view

### Purchased Items
- Create/Edit/Delete from Purchase view
- Item and Vendor selected by name (resolved from Masters)

### Masters (Customer / Location / Item / Vendor)
- Full CRUD from Masters view (management only)
- Location form auto-links to Customer

---

## API Actions

All calls go through JSONP GET with `auth` + `action` + `data` payload.

| Action | Role | Description |
|---|---|---|
| `login` | — | Verify email + password |
| `getAllData` | both | Load all data in one call |
| `getOrderDetails` | both | Single order full detail |
| `updateOrderStatus` | both | Advance pipeline step |
| `createOrder` / `updateOrder` / `deleteOrder` | management | Order CRUD |
| `createIndent` / `updateIndent` / `deleteIndent` | management | Indent CRUD |
| `createPurchased` / `updatePurchased` / `deletePurchased` | management | Purchase CRUD |
| `createDump` / `deleteDump` | management | Dump log |
| `create/update/deleteCustomer` | management | Customer master |
| `create/update/deleteLocation` | management | Location master |
| `create/update/deleteItem` | management | Item master |
| `create/update/deleteVendor` | management | Vendor master |

---

## PWA — Install as App

**Android:** Open Chrome → Visit URL → Menu → "Add to Home Screen"

**iOS:** Open Safari → Visit URL → Share → "Add to Home Screen"

Once installed, opens as full-screen standalone app with no browser bar.

---

## Updating After Deployment

### If you change `Code.gs`:
1. Open Apps Script
2. Deploy → Manage Deployments → Edit → New Version → Deploy
3. The URL stays the same — no changes needed in `apiconfig.js`

### If you change frontend files:
```bash
git add .
git commit -m "Update: <what changed>"
git push origin main
```
GitHub Pages deploys in ~60 seconds.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Set GAS_URL in apiconfig.js" on load | Paste your Web App URL in `apiconfig.js` |
| Login fails with correct password | Check `Users` sheet exists in Masters workbook with correct column names |
| Data not loading | Redeploy Code.gs with "New Version" — old deployments cache |
| Customer names showing as UUIDs | Masters workbook ID is wrong in Code.gs — check `MASTERS_ID` variable |
| "Access denied" on CRUD | User's role in `Users` sheet must be exactly `management` (lowercase) |
| Photos not showing | Check `drivePhotoBase` in `apiconfig.js` or verify photo URLs in sheet |
| Service worker shows old version | Open DevTools → Application → Service Workers → "Update on reload" |

---

## Built With

- [Google Apps Script](https://developers.google.com/apps-script) — serverless backend
- [GitHub Pages](https://pages.github.com) — free static hosting
- [Chart.js](https://www.chartjs.org) — charts
- [Font Awesome](https://fontawesome.com) — icons
- [Inter](https://rsms.me/inter/) — typography

---

*Fresko O2D Analytics — Built by [Autoworkflow LLP](https://autoworkflow.in)*
