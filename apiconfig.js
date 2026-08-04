// ============================================================
//  O2D Analytics — API Configuration
//  devfresko/o2danalytics
//
//  STEPS:
//  1. Deploy Code.gs in Apps Script:
//       Deploy → New Deployment → Web App
//       Execute as: Me
//       Who has access: Anyone
//  2. Copy the Web App URL
//  3. Paste it below as GAS_URL
//  4. Commit this file → GitHub Pages rebuilds
// ============================================================

var GAS_URL = 'https://script.google.com/macros/s/AKfycbzA2orqBkMYLzcoSE4maW5x00kW8CMvjYRRsnYONj3QazEEFKuvKXp94h8IdoYQRCGR/exec';
// Example:
// var GAS_URL = 'https://script.google.com/macros/s/AKfycby.../exec';

// ── App-level config (edit if needed) ──────────────────────
var APP_CONFIG = {
  appName:       'O2D Analytics',
  orgName:       'Fresko',
  // How often to auto-refresh data (ms). 0 = disabled.
  autoRefreshMs: 5 * 60 * 1000,   // 5 minutes
  // JSONP timeout (ms)
  apiTimeoutMs:  25000,
  // Default view on first load
  defaultView:   'kanban',
  // Google Drive photo base URL (if photos are stored on Drive)
  // Leave empty if photo paths are full URLs already
  drivePhotoBase: '',
};
