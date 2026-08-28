import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'docs', 'marketing-package', 'master', 'icons');

const seedIcons = [
  ['home', 'Home', 'nav', 'home'],
  ['search', 'Search', 'nav', 'search'],
  ['menu', 'Menu', 'nav', 'menu'],
  ['more-horizontal', 'More', 'nav', 'moreH'],
  ['more-vertical', 'More vertical', 'nav', 'moreV'],
  ['arrow-left', 'Arrow left', 'nav', 'arrowLeft'],
  ['arrow-right', 'Arrow right', 'nav', 'arrowRight'],
  ['arrow-up', 'Arrow up', 'nav', 'arrowUp'],
  ['arrow-down', 'Arrow down', 'nav', 'arrowDown'],
  ['external-link', 'External link', 'nav', 'external'],
  ['user', 'User', 'identity', 'user'],
  ['users', 'Users', 'identity', 'users'],
  ['team', 'Team', 'identity', 'team'],
  ['profile', 'Profile', 'identity', 'profile'],
  ['badge', 'Badge', 'identity', 'badge'],
  ['lock', 'Lock', 'security', 'lock'],
  ['unlock', 'Unlock', 'security', 'unlock'],
  ['key', 'Key', 'security', 'key'],
  ['shield', 'Shield', 'security', 'shield'],
  ['shield-check', 'Shield check', 'security', 'shieldCheck'],
  ['file', 'File', 'files', 'file'],
  ['file-text', 'File text', 'files', 'fileText'],
  ['files', 'Files', 'files', 'files'],
  ['folder', 'Folder', 'files', 'folder'],
  ['folder-open', 'Folder open', 'files', 'folderOpen'],
  ['copy', 'Copy', 'actions', 'copy'],
  ['duplicate', 'Duplicate', 'files', 'duplicate'],
  ['archive', 'Archive', 'files', 'archive'],
  ['download', 'Download', 'actions', 'download'],
  ['upload', 'Upload', 'actions', 'upload'],
  ['plus', 'Plus', 'actions', 'plus'],
  ['minus', 'Minus', 'actions', 'minus'],
  ['check', 'Check', 'status', 'check'],
  ['x', 'Close', 'status', 'x'],
  ['edit', 'Edit', 'actions', 'edit'],
  ['trash', 'Trash', 'actions', 'trash'],
  ['restore', 'Restore', 'actions', 'restore'],
  ['refresh', 'Refresh', 'actions', 'refresh'],
  ['sync', 'Sync', 'actions', 'sync'],
  ['filter', 'Filter', 'actions', 'filter'],
  ['settings', 'Settings', 'system', 'settings'],
  ['sliders', 'Sliders', 'system', 'sliders'],
  ['toggle', 'Toggle', 'system', 'toggle'],
  ['bell', 'Bell', 'communication', 'bell'],
  ['mail', 'Mail', 'communication', 'mail'],
  ['message', 'Message', 'communication', 'message'],
  ['phone', 'Phone', 'communication', 'phone'],
  ['calendar', 'Calendar', 'time', 'calendar'],
  ['clock', 'Clock', 'time', 'clock'],
  ['timer', 'Timer', 'time', 'timer'],
  ['database', 'Database', 'data', 'database'],
  ['server', 'Server', 'data', 'server'],
  ['cloud', 'Cloud', 'data', 'cloud'],
  ['cloud-off', 'Cloud off', 'data', 'cloudOff'],
  ['wifi', 'Wifi', 'data', 'wifi'],
  ['terminal', 'Terminal', 'developer', 'terminal'],
  ['code', 'Code', 'developer', 'code'],
  ['bug', 'Bug', 'developer', 'bug'],
  ['cpu', 'CPU', 'developer', 'cpu'],
  ['activity', 'Activity', 'analytics', 'activity'],
  ['chart-line', 'Chart line', 'analytics', 'chartLine'],
  ['chart-bar', 'Chart bar', 'analytics', 'chartBar'],
  ['pie-chart', 'Pie chart', 'analytics', 'pie'],
  ['dashboard', 'Dashboard', 'analytics', 'dashboard'],
  ['eye', 'Preview', 'review', 'eye'],
  ['eye-off', 'Preview off', 'review', 'eyeOff'],
  ['compare', 'Compare', 'review', 'compare'],
  ['split-view', 'Split view', 'review', 'split'],
  ['zoom-in', 'Zoom in', 'review', 'zoomIn'],
  ['zoom-out', 'Zoom out', 'review', 'zoomOut'],
  ['image', 'Image', 'media', 'image'],
  ['video', 'Video', 'media', 'video'],
  ['audio', 'Audio', 'media', 'audio'],
  ['music', 'Music', 'media', 'music'],
  ['pdf', 'PDF', 'files', 'pdf'],
  ['compress', 'Compress', 'files', 'compress'],
  ['expand', 'Expand', 'files', 'expand'],
  ['scan', 'Scan', 'files', 'scan'],
  ['spark', 'Spark', 'brand', 'spark'],
  ['crown-spark', 'Crown spark', 'brand', 'crownSpark'],
  ['payment', 'Payment', 'commerce', 'payment'],
  ['receipt', 'Receipt', 'commerce', 'receipt'],
  ['license', 'License', 'commerce', 'license'],
  ['tag', 'Tag', 'commerce', 'tag'],
  ['cart', 'Cart', 'commerce', 'cart'],
  ['support', 'Support', 'service', 'support'],
  ['help', 'Help', 'service', 'help'],
  ['info', 'Info', 'service', 'info'],
  ['warning', 'Warning', 'status', 'warning'],
  ['error', 'Error', 'status', 'error'],
  ['success', 'Success', 'status', 'success'],
  ['pending', 'Pending', 'status', 'pending'],
  ['local-device', 'Local device', 'system', 'localDevice'],
  ['desktop', 'Desktop', 'system', 'desktop'],
  ['laptop', 'Laptop', 'system', 'laptop'],
  ['drive', 'Drive', 'system', 'drive'],
  ['registry', 'Registry', 'system', 'registry'],
  ['audit-log', 'Audit log', 'governance', 'audit'],
  ['export', 'Export', 'actions', 'exportIcon'],
  ['import', 'Import', 'actions', 'importIcon'],
];

const variants = [
  ['checked', 'checked', 'status', 'check'],
  ['add', 'add', 'actions', 'plus'],
  ['remove', 'remove', 'actions', 'minus'],
  ['locked', 'locked', 'security', 'lock'],
  ['alert', 'alert', 'status', 'warning'],
];

function buildIconSet() {
  const result = [...seedIcons];

  for (const [suffix, labelSuffix, category, modifierShape] of variants) {
    for (const [id, label, baseCategory, shape] of seedIcons) {
      if (result.length >= 500) {
        return result;
      }

      result.push([
        `${id}-${suffix}`,
        `${label} ${labelSuffix}`,
        category === 'status' ? `${baseCategory}/status` : category,
        `${shape}+${modifierShape}`,
      ]);
    }
  }

  return result;
}

const icons = buildIconSet();

function base(shape) {
  const p = {
    home: '<path d="M4 11L12 4L20 11V20H6V12H18V20"/><path d="M10 20V14H14V20"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16L21 21"/>',
    menu: '<path d="M4 7H20M4 12H20M4 17H20"/>',
    moreH: '<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>',
    moreV: '<circle cx="12" cy="6" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/>',
    arrowLeft: '<path d="M19 12H5M11 6L5 12L11 18"/>',
    arrowRight: '<path d="M5 12H19M13 6L19 12L13 18"/>',
    arrowUp: '<path d="M12 19V5M6 11L12 5L18 11"/>',
    arrowDown: '<path d="M12 5V19M6 13L12 19L18 13"/>',
    external: '<path d="M8 7H6C5 7 4 8 4 9V18C4 19 5 20 6 20H15C16 20 17 19 17 18V16"/><path d="M13 4H20V11M20 4L11 13"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M5 21C6 17 8 15 12 15C16 15 18 17 19 21"/>',
    users: '<circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 21C4 17 6 15 9 15M13 16C16 16 19 18 20 21"/>',
    team: '<circle cx="12" cy="7" r="3"/><circle cx="6" cy="11" r="2.5"/><circle cx="18" cy="11" r="2.5"/><path d="M4 21C5 17 8 15 12 15C16 15 19 17 20 21"/>',
    profile: '<rect x="5" y="4" width="14" height="16" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17C9 15.5 10 15 12 15C14 15 15 15.5 16 17"/>',
    badge: '<path d="M12 3L19 7V13C19 17 16 20 12 21C8 20 5 17 5 13V7L12 3Z"/><path d="M9 12L11 14L15 10"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V8C8 5.8 9.8 4 12 4C14.2 4 16 5.8 16 8V10"/>',
    unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V8C8 5.8 9.8 4 12 4C13.5 4 14.8 4.8 15.5 6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12L20 3M16 7L19 10M14 9L17 12"/>',
    shield: '<path d="M12 3L19 7V12C19 16.5 16 19.5 12 21C8 19.5 5 16.5 5 12V7L12 3Z"/>',
    shieldCheck: '<path d="M12 3L19 7V12C19 16.5 16 19.5 12 21C8 19.5 5 16.5 5 12V7L12 3Z"/><path d="M9 12L11 14L15 10"/>',
    file: '<path d="M7 3H14L19 8V21H7V3Z"/><path d="M14 3V8H19"/>',
    fileText: '<path d="M7 3H14L19 8V21H7V3Z"/><path d="M14 3V8H19M9 12H16M9 16H14"/>',
    files: '<path d="M8 4H15L19 8V19H8V4Z"/><path d="M5 7V22H16"/>',
    folder: '<path d="M3 7H9L11 10H21V19H3V7Z"/>',
    folderOpen: '<path d="M3 8H9L11 11H21L19 20H3V8Z"/><path d="M3 11H21"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 16V5H16"/>',
    duplicate: '<rect x="6" y="6" width="8" height="8" rx="2"/><rect x="10" y="10" width="8" height="8" rx="2"/>',
    archive: '<path d="M4 6H20V20H4V6Z"/><path d="M4 10H20M10 6V10M14 6V10"/>',
    download: '<path d="M12 4V15M7 10L12 15L17 10M5 20H19"/>',
    upload: '<path d="M12 15V4M7 9L12 4L17 9M5 20H19"/>',
    plus: '<path d="M12 5V19M5 12H19"/>',
    minus: '<path d="M5 12H19"/>',
    check: '<path d="M5 12L10 17L20 7"/>',
    x: '<path d="M6 6L18 18M18 6L6 18"/>',
    edit: '<path d="M4 20H9L20 9L15 4L4 15V20Z"/><path d="M14 5L19 10"/>',
    trash: '<path d="M5 7H19M10 11V17M14 11V17M7 7L8 20H16L17 7M9 7V4H15V7"/>',
    restore: '<path d="M6 8H4V4M4 8C6 5 9 4 12 4C16.4 4 20 7.6 20 12C20 16.4 16.4 20 12 20C9 20 6.5 18.5 5 16"/><path d="M12 8V12L15 14"/>',
    refresh: '<path d="M20 7V3H16M20 3L16 7C14 5 10.5 4.5 8 6C4.7 8 4 12.5 6.3 15.5M4 17V21H8M4 21L8 17C10 19 13.5 19.5 16 18C19.3 16 20 11.5 17.7 8.5"/>',
    sync: '<path d="M7 7H17L14 4M17 17H7L10 20"/>',
    filter: '<path d="M4 5H20L14 12V19L10 21V12L4 5Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3V6M12 18V21M3 12H6M18 12H21M5 5L7 7M17 17L19 19M19 5L17 7M7 17L5 19"/>',
    sliders: '<path d="M4 7H12M16 7H20M4 17H8M12 17H20"/><circle cx="14" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    toggle: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="15" cy="12" r="3"/>',
    bell: '<path d="M6 17H18L16 14V10C16 7.5 14.5 5.5 12 5.5C9.5 5.5 8 7.5 8 10V14L6 17Z"/><path d="M10 20H14"/>',
    mail: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 8L12 13L20 8"/>',
    message: '<path d="M4 5H20V16H8L4 20V5Z"/>',
    phone: '<path d="M8 4L11 9L9 11C10.2 13.5 12.5 15.8 15 17L17 15L22 18C21 20 19.5 21 17.5 21C10 21 3 14 3 6.5C3 4.5 4 3 6 2L8 4Z"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3V7M16 3V7M4 10H20"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7V12L16 14"/>',
    timer: '<circle cx="12" cy="13" r="7"/><path d="M9 3H15M12 6V3M12 13L15 10"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6V18C5 19.7 8.1 21 12 21C15.9 21 19 19.7 19 18V6M5 12C5 13.7 8.1 15 12 15C15.9 15 19 13.7 19 12"/>',
    server: '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><path d="M7 7H7.1M7 17H7.1"/>',
    cloud: '<path d="M7 18H18C20 18 21.5 16.5 21.5 14.5C21.5 12.5 20 11 18 11C17 7 13 5 9.5 7C7.5 8 6.5 10 6.5 12C4.5 12.2 3 13.5 3 15.3C3 16.8 4.5 18 7 18Z"/>',
    cloudOff: '<path d="M4 4L20 20M7 18H18C19 18 19.8 17.8 20.4 17.3M17.5 11C16.5 7 13 5 9.5 7C8.8 7.3 8.2 7.8 7.7 8.3M6.5 12C4.5 12.2 3 13.5 3 15.3C3 16.8 4.5 18 7 18"/>',
    wifi: '<path d="M4 9C8.5 5.5 15.5 5.5 20 9M7 13C10 11 14 11 17 13M10 17C11.2 16.2 12.8 16.2 14 17M12 20H12.1"/>',
    terminal: '<path d="M4 5H20V19H4V5Z"/><path d="M7 9L10 12L7 15M12 15H17"/>',
    code: '<path d="M8 8L4 12L8 16M16 8L20 12L16 16M14 5L10 19"/>',
    bug: '<path d="M8 8C8 6 10 4 12 4C14 4 16 6 16 8V15C16 18 14 20 12 20C10 20 8 18 8 15V8Z"/><path d="M5 9H8M16 9H19M5 15H8M16 15H19M9 5L7 3M15 5L17 3M10 11H10.1M14 11H14.1"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 9H7M4 15H7M17 9H20M17 15H20M9 4V7M15 4V7M9 17V20M15 17V20"/>',
    activity: '<path d="M4 13H8L10 6L14 18L16 13H20"/>',
    chartLine: '<path d="M4 19H20M6 16L10 12L13 14L19 7"/>',
    chartBar: '<path d="M5 19V11M12 19V5M19 19V8M3 19H21"/>',
    pie: '<path d="M12 4V12H20C20 7.6 16.4 4 12 4Z"/><path d="M12 12V4C7.6 4 4 7.6 4 12C4 16.4 7.6 20 12 20C16.4 20 20 16.4 20 12H12Z"/>',
    dashboard: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 15L12 11L16 15M12 11V8"/>',
    eye: '<path d="M3 12C5.5 7.5 8.5 6 12 6C15.5 6 18.5 7.5 21 12C18.5 16.5 15.5 18 12 18C8.5 18 5.5 16.5 3 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M4 4L20 20M9.5 5.5C10.3 5.2 11.1 5 12 5C15.5 5 18.5 7 21 12C20.2 13.5 19.2 14.8 18.1 15.8M14 17.5C13.3 17.8 12.7 18 12 18C8.5 18 5.5 16.5 3 12C4 10 5.3 8.4 6.8 7.3"/>',
    compare: '<rect x="4" y="5" width="7" height="14" rx="1"/><rect x="13" y="5" width="7" height="14" rx="1"/><path d="M11 12H13"/>',
    split: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M12 5V19"/>',
    zoomIn: '<circle cx="10" cy="10" r="6"/><path d="M15 15L21 21M10 7V13M7 10H13"/>',
    zoomOut: '<circle cx="10" cy="10" r="6"/><path d="M15 15L21 21M7 10H13"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17L10 12L13 15L15 13L20 18"/>',
    video: '<rect x="4" y="6" width="12" height="12" rx="2"/><path d="M16 10L21 7V17L16 14"/>',
    audio: '<path d="M5 14V10M9 17V7M13 20V4M17 17V7M21 14V10"/>',
    music: '<path d="M9 18V6L18 4V16"/><circle cx="7" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
    pdf: '<path d="M7 3H14L19 8V21H7V3Z"/><path d="M14 3V8H19M9 16H15M9 12H16"/>',
    compress: '<path d="M8 4V9H3M16 4V9H21M8 20V15H3M16 20V15H21"/>',
    expand: '<path d="M4 9V4H9M20 9V4H15M4 15V20H9M20 15V20H15"/>',
    scan: '<path d="M4 8V5C4 4.4 4.4 4 5 4H8M16 4H19C19.6 4 20 4.4 20 5V8M20 16V19C20 19.6 19.6 20 19 20H16M8 20H5C4.4 20 4 19.6 4 19V16M7 12H17"/>',
    spark: '<path d="M12 3V8M12 16V21M3 12H8M16 12H21M6 6L9 9M18 6L15 9M6 18L9 15M18 18L15 15"/>',
    crownSpark: '',
    payment: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10H21M7 15H11"/>',
    receipt: '<path d="M6 3H18V21L15 19L12 21L9 19L6 21V3Z"/><path d="M9 8H15M9 12H15M9 16H13"/>',
    license: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9H16M8 13H13M15 17L17 19L20 15"/>',
    tag: '<path d="M4 11L11 4H20V13L13 20L4 11Z"/><circle cx="16" cy="8" r="1.5"/>',
    cart: '<path d="M3 4H5L7 15H18L20 7H6M9 20H9.1M17 20H17.1"/>',
    support: '<circle cx="12" cy="12" r="8"/><path d="M8 13V10C8 7.8 9.8 6 12 6C14.2 6 16 7.8 16 10V13M8 13H6V10H8M16 13H18V10H16M10 18H14"/>',
    help: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9C10 7.5 11 7 12.5 7C14 7 15 8 15 9.3C15 11.5 12 11.5 12 14M12 17H12.1"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11V16M12 8H12.1"/>',
    warning: '<path d="M12 4L21 20H3L12 4Z"/><path d="M12 9V14M12 17H12.1"/>',
    error: '<circle cx="12" cy="12" r="8"/><path d="M8 8L16 16M16 8L8 16"/>',
    success: '<circle cx="12" cy="12" r="8"/><path d="M8 12L11 15L16 9"/>',
    pending: '<circle cx="12" cy="12" r="8"/><path d="M12 7V12L15 15"/>',
    localDevice: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M8 20H16M12 16V20"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21H16M12 16V21"/>',
    laptop: '<path d="M5 5H19V16H5V5Z"/><path d="M3 19H21L19 16H5L3 19Z"/>',
    drive: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M7 15H17M8 9H16"/>',
    registry: '<rect x="5" y="5" width="6" height="6"/><rect x="13" y="5" width="6" height="6"/><rect x="5" y="13" width="6" height="6"/><rect x="13" y="13" width="6" height="6"/>',
    audit: '<path d="M6 3H18V21H6V3Z"/><path d="M9 8H15M9 12H15M9 16H12M14 17L16 19L20 15"/>',
    exportIcon: '<path d="M12 14V4M7 9L12 4L17 9M5 14V20H19V14"/>',
    importIcon: '<path d="M12 4V14M7 9L12 14L17 9M5 14V20H19V14"/>',
  };
  if (shape.includes('+')) {
    const [baseShape, modifierShape] = shape.split('+');
    return `${p[baseShape] ?? p.file}${modifier(modifierShape)}`;
  }

  return p[shape] ?? p.file;
}

function modifier(shape) {
  const path = {
    check: '<path d="M15.2 18L17.2 20L21 16.2"/>',
    plus: '<path d="M18 15.5V21M15.25 18.25H20.75"/>',
    minus: '<path d="M15.4 18.25H20.6"/>',
    lock: '<rect x="15.2" y="16.8" width="5.8" height="4.5" rx="1"/><path d="M16.5 16.8V15.8C16.5 14.9 17.2 14.2 18.1 14.2C19 14.2 19.7 14.9 19.7 15.8V16.8"/>',
    warning: '<path d="M18 14.5L21.3 21H14.7L18 14.5Z"/><path d="M18 17.2V18.7M18 20H18.05"/>',
  };

  return `<g class="tws-modifier">${path[shape] ?? path.plus}</g>`;
}

function spark() {
  return '<g class="tws-spark"><circle cx="18.2" cy="4.3" r="1.35"/><path d="M18.2 1.4V2.6M15.8 5.4L14.8 4.4M20.6 5.4L21.6 4.4"/></g>';
}

function symbol([id, , , shape]) {
  return `<symbol id="tws-${id}" viewBox="0 0 24 24"><g class="tws-icon-base">${base(shape)}</g>${spark()}</symbol>`;
}

function sprite() {
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<defs>
<style>
.tws-icon-base{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.tws-modifier{fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}
.tws-spark{fill:#c77a15;stroke:#c77a15;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round}
</style>
${icons.map(symbol).join('\n')}
</defs>
</svg>
`;
}

const sheetThemes = {
  light: {
    title: 'Technowiz 500 icon sheet',
    description: 'Five hundred industry-standard UI icons with a small Technowiz R2 crown-spark accent.',
    page: '#f8fafc',
    panel: '#ffffff',
    line: '#d9e1ea',
    icon: '#102033',
    heading: '#102033',
    body: '#667085',
    meta: '#667085',
  },
  dark: {
    title: 'Technowiz 500 icon sheet dark',
    description: 'Dark-background presentation of the 500 standard UI/product icons with the official R2 crown-spark accent.',
    page: '#07111f',
    panel: '#101d2d',
    line: '#27384d',
    icon: '#f8fafc',
    heading: '#ffffff',
    body: '#cbd7e5',
    meta: '#91a4bb',
  },
};

function sheet(iconList = icons, title = 'Technowiz icon sheet 001-500', description = '500 standard UI/product icons with a small official R2 crown-spark accent.', theme = sheetThemes.light) {
  const cell = 128;
  const margin = 48;
  const width = margin * 2 + cell * 10;
  const rows = Math.ceil(iconList.length / 10);
  const height = 170 + margin + cell * rows;
  const symbols = iconList.map(symbol).join('\n');
  const cells = iconList.map(([id, label, category], index) => {
    const col = index % 10;
    const row = Math.floor(index / 10);
    const x = margin + col * cell;
    const y = 170 + row * cell;
    return `<g transform="translate(${x} ${y})">
  <rect width="112" height="112" rx="12" fill="${theme.panel}" stroke="${theme.line}"/>
  <use href="#tws-${id}" x="34" y="20" width="44" height="44" color="${theme.icon}"/>
  <text x="56" y="82" text-anchor="middle" fill="${theme.heading}" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700">${escapeXml(label)}</text>
  <text x="56" y="98" text-anchor="middle" fill="${theme.meta}" font-family="Arial, Helvetica, sans-serif" font-size="9" font-weight="500">${escapeXml(category)}</text>
</g>`;
  }).join('\n');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(theme.title)}</title>
<desc id="desc">${escapeXml(theme.description)}</desc>
<rect width="${width}" height="${height}" fill="${theme.page}"/>
<defs>
<style>
.tws-icon-base{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.tws-modifier{fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}
.tws-spark{fill:#c77a15;stroke:#c77a15;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round}
</style>
${symbols}
</defs>
<text x="48" y="62" fill="${theme.heading}" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="760">${escapeXml(title)}</text>
<text x="48" y="100" fill="${theme.body}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="520">${escapeXml(description)}</text>
<text x="48" y="132" fill="${theme.body}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="520">Grid: 24px icon, 1.8px stroke, rounded caps, currentColor base, #c77a15 spark.</text>
${cells}
</svg>
`;
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tws-icons-001-500.svg'), sheet());
writeFileSync(
  join(outDir, 'tws-icons-001-500-dark.svg'),
  sheet(
    icons,
    'Technowiz icon sheet 001-500 dark',
    'Dark-background presentation of all 500 icons from the master system.',
    sheetThemes.dark
  )
);
for (let index = 0; index < 5; index++) {
  const start = index * 100;
  const end = start + 100;
  const batch = icons.slice(start, end);
  const label = `${String(start + 1).padStart(3, '0')}-${String(end).padStart(3, '0')}`;
  writeFileSync(
    join(outDir, `tws-icons-${label}.svg`),
    sheet(
      batch,
      `Technowiz icon sheet ${label}`,
      `Batch ${index + 1} of 5 from the 500-icon master system.`
    )
  );
  writeFileSync(
    join(outDir, `tws-icons-${label}-dark.svg`),
    sheet(
      batch,
      `Technowiz icon sheet ${label} dark`,
      `Dark-background batch ${index + 1} of 5 from the 500-icon master system.`,
      sheetThemes.dark
    )
  );
}
writeFileSync(join(outDir, 'tws-icons-sprite.svg'), sprite());
writeFileSync(join(outDir, 'tws-icons-manifest.json'), JSON.stringify({
  name: 'Technowiz Icon Sheet 001-500',
  version: '0.2.0',
  count: icons.length,
  grid: 24,
  stroke: 1.8,
  accent: 'official R2 crown-spark',
  sheets: {
    light: [
      'tws-icons-001-500.svg',
      'tws-icons-001-100.svg',
      'tws-icons-101-200.svg',
      'tws-icons-201-300.svg',
      'tws-icons-301-400.svg',
      'tws-icons-401-500.svg',
    ],
    dark: [
      'tws-icons-001-500-dark.svg',
      'tws-icons-001-100-dark.svg',
      'tws-icons-101-200-dark.svg',
      'tws-icons-201-300-dark.svg',
      'tws-icons-301-400-dark.svg',
      'tws-icons-401-500-dark.svg',
    ],
  },
  icons: icons.map(([id, label, category]) => ({ id: `tws-${id}`, name: label, category })),
}, null, 2) + '\n');

console.log(`Generated ${icons.length} icons with light and dark sheets in ${outDir}`);
