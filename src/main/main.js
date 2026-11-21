'use strict';
// 진도 위젯 시작점 (Electron main 프로세스)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, screen, dialog, globalShortcut, shell } = require('electron');
const autostart = require('./autostart');
const { createUpdater } = require('./updater');

const native = require('./native');
const dialogs = require('./dialogs');
const { popupMenu, closeMenu } = require('./popup-menu');
const { createProgressWindow } = require('./progress-window');
const { createSettingsWindow } = require('./settings-window');
const { Store, defaultDataDir } = require('../core/storage');
const { completion, cloneData, planColor, VIEW_ALL } = require('../core/data');
const { undoPlan } = require('../core/actions');
const { SaveScheduler } = require('../core/save-scheduler');
const { checkImage, MAX_IMAGE_BYTES, sniffImage } = require('../core/image-info');

const TRACK_HEIGHT = 150;
const DATA_DIR = process.env.JINDO_DATA_DIR || defaultDataDir();

app.setAppUserModelId('JindoWidget');

const ctx = {
  store: new Store({ dataDir: DATA_DIR }),
  data: null,
  saver: null,
  track: null,
  imageIssues: new Set(),
  quitting: false,
  undo: null, // 계획 변경 되돌리기용: 변경 직전 상태 (한 번만)
  pendingUpdate: null, // 자동 확인에서 찾은 새 버전
  progress: null,
};

// ── 데이터 바꾸기: 바꾼 뒤 바로 저장하고 화면을 새로 그림 ──
function afterChange() {
  ctx.saver.flush();
  pushTrack();
  if (ctx.progress) ctx.progress.refresh();
}
function commit(fn) {
  fn();
  afterChange();
}
// 계획(차시·활동) 변경은 되돌릴 수 있게 직전 상태를 남겨 둠
function commitPlan(fn) {
  const snapshot = cloneData(ctx.data);
  fn();
  ctx.undo = snapshot;
  afterChange();
}
// 데이터를 통째로 바꿈(백업에서 복원). 열린 창들은 옛 데이터를 보고 있으니 닫습니다.
function replaceData(next) {
  if (ctx.progress) ctx.progress.close();
  if (ctx.settings) ctx.settings.close();
  ctx.undo = null;
  ctx.data = next;
  pushTrack();
}

function undo() {
  if (!ctx.undo) return;
  undoPlan(ctx.data, ctx.undo);
  ctx.undo = null;
  afterChange();
}

// ── 저장 ──
let saveErrorShown = false;
function setupSaver() {
  ctx.saver = new SaveScheduler({
    save: () => ctx.store.save(ctx.data),
    onStatus: (status) => {
      app.emit('jindo:save-status', status);
      if (ctx.progress) ctx.progress.sendStatus(status);
    },
    onError: (err) => {
      if (saveErrorShown) return;
      saveErrorShown = true;
      dialogs.notify('진도를 저장할 수 없어요', '저장 위치의 권한과 여유 공간을 확인해 주세요.', null, String(err.message || err));
    },
  });
  app.on('jindo:save-status', (status) => {
    if (status === '저장됨') saveErrorShown = false;
  });
}

// ── 트랙 창 ──
// 반 · 캐릭터 설정 창이 열려 있으면 그 미리 보기를 그립니다.
function shownData() {
  return (ctx.previewData && ctx.previewData()) || ctx.data;
}

// 바탕 화면 말풍선 안내: 한 번에 하나씩, 해야 할 일 바로 옆에서. 각각 한 번만 뜸
//  start: 첫 "+" 옆 → 그림 고르기 / use: 그림 있는 캐릭터 옆 → 클릭·우클릭 / flag: 깃발 위 → 학년 바꾸기
function currentHint(d) {
  if (ctx.settings && ctx.settings.isOpen()) return null; // 설정 미리 보기 중에는 안 띄움
  const visible = (c) => d.plans.length < 2 || d.view_plan === VIEW_ALL || c.plan_id === d.view_plan;
  const hasImage = d.classes.some((c) => c.custom_image);
  if (!d.hint_start_seen && !hasImage) {
    const idx = d.classes.findIndex((c) => visible(c) && !c.custom_image);
    if (idx >= 0) return { kind: 'start', idx };
  }
  if (d.hint_start_seen && !d.hint_use_seen && hasImage) {
    const idx = d.classes.findIndex((c) => visible(c) && c.custom_image);
    if (idx >= 0) return { kind: 'use', idx };
  }
  if (d.plans.length > 1 && !d.flag_hint_seen) return { kind: 'flag' };
  return null;
}

function trackViewModel() {
  const d = shownData();
  return {
    classes: d.classes.map((cls, idx) => ({
      name: cls.name,
      percent: completion(d, idx),
      imageKey: cls.custom_image || null,
      planId: cls.plan_id,
    })),
    plans: d.plans.map((p) => ({ id: p.id, name: p.name, color: planColor(d, p.id) })),
    view: d.plans.length > 1 ? d.view_plan : VIEW_ALL,
    hint: currentHint(d),
    // 새 버전 말풍선: ✕로 닫은 버전은 다시 띄우지 않음 (다음 버전이 나오면 다시)
    update: ctx.pendingUpdate && ctx.pendingUpdate.version !== d.update_dismissed ? { version: ctx.pendingUpdate.version } : null,
    scale: d.character_scale,
    float: d.float_motion,
    labels: d.show_progress_labels,
  };
}

function pushTrack() {
  if (ctx.track && !ctx.track.isDestroyed()) ctx.track.webContents.send('track:state', trackViewModel());
}

// 작업표시줄 바로 위. 작업표시줄이 위·옆에 있거나 자동 숨김이면 화면 맨 아래에 놓입니다.
function placeTrack() {
  const win = ctx.track;
  if (!win || win.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = { x: wa.x, y: wa.y + wa.height - TRACK_HEIGHT, width: wa.width, height: TRACK_HEIGHT };
  win.setBounds(bounds);
  native.sendToBottom(win);
  // 화면 크기·작업 표시줄이 바뀌면 열린 진도창도 캐릭터 위로 다시 맞춤
  if (ctx.progress && ctx.progress.isOpen()) {
    const idx = ctx.progress.classIdx;
    setTimeout(() => { if (ctx.track && !ctx.track.isDestroyed()) ctx.track.webContents.send('track:rect-request', idx); }, 300);
  }
}

function createTrack() {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,     // 눌러도 앞으로 나오지 않음
    hasShadow: false,
    alwaysOnTop: false,
    title: '진도 위젯',
    webPreferences: {
      preload: path.join(__dirname, 'preload-track.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  ctx.track = win;
  win.removeMenu();
  win.setIgnoreMouseEvents(true, { forward: true });
  placeTrack();
  win.once('ready-to-show', () => {
    win.showInactive();
    placeTrack();
  });
  win.on('closed', () => { ctx.track = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'track.html'));
}

ipcMain.handle('track:state', () => trackViewModel());

ipcMain.handle('track:image', async (_e, idx) => {
  const cls = shownData().classes[idx];
  if (!cls || !cls.custom_image) return { ok: false };
  try {
    const stat = await fs.promises.stat(cls.custom_image);
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('이미지 파일이 20MB보다 커요.');
    const bytes = await fs.promises.readFile(cls.custom_image);
    const info = sniffImage(bytes.subarray(0, 512 * 1024));
    return { ok: true, bytes, mime: info ? info.mime : 'image/png' };
  } catch (err) {
    noteImageIssue(cls.name, err.code === 'ENOENT' ? '이미지 파일을 찾을 수 없어요.' : err.message);
    return { ok: false };
  }
});

// 위젯(캐릭터·깃발·말풍선)을 왼쪽 클릭하면 열려 있던 우클릭 메뉴는 닫음
ipcMain.on('track:press', () => closeMenu());

ipcMain.on('track:interactive', (_e, on) => {
  if (ctx.track && !ctx.track.isDestroyed()) ctx.track.setIgnoreMouseEvents(!on, { forward: true });
});

ipcMain.on('track:image-failed', (_e, idx, message) => {
  const cls = ctx.data.classes[idx];
  if (cls) noteImageIssue(cls.name, `이미지를 그리지 못했어요. (${message})`);
});

// 트랙 창 안 좌표 → 화면 좌표
function toScreenRect(r) {
  const b = ctx.track.getBounds();
  return { x: b.x + r.x, y: b.y + r.y, width: r.width, height: r.height };
}

// 설정 창이 열려 있으면 바탕 화면은 미리 보기라서, 진도창 대신 설정 창을 앞으로
function settingsBusy() {
  if (ctx.settings && ctx.settings.isOpen()) {
    ctx.settings.open();
    return true;
  }
  return false;
}

ipcMain.on('track:click', (_e, idx, rect) => {
  if (!ctx.data.classes[idx] || !ctx.track || settingsBusy()) return;
  ctx.progress.open(idx, toScreenRect(rect));
});

// 사용 설명서: 앱 안의 창으로 엽니다 (PDF 프로그램을 따로 띄우지 않음)
let manualWindow = null;
function openManual() {
  if (manualWindow && !manualWindow.isDestroyed()) {
    if (manualWindow.isMinimized()) manualWindow.restore();
    manualWindow.show();
    manualWindow.focus();
    return;
  }
  manualWindow = new BrowserWindow({
    width: 600,
    height: 780,
    minWidth: 440,
    minHeight: 480,
    show: false,
    title: '진도 위젯 사용 설명서',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#FFF7F0',
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  manualWindow.removeMenu();
  // 설명서 안의 링크로 다른 곳으로 이동하지 않게 막고, 인터넷 주소는 기본 브라우저로
  manualWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  manualWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  manualWindow.once('ready-to-show', () => manualWindow.show());
  manualWindow.on('closed', () => { manualWindow = null; });
  manualWindow.loadFile(path.join(__dirname, '..', '..', 'docs', 'guide', 'index.html'));
}

// 우클릭 메뉴: 자주 쓰는 것만. 나머지는 모두 "설정" 창 안에 있음
ipcMain.on('track:context', async () => {
  const id = await popupMenu({
    items: [
      { id: 'settings', label: '설정' },
      { id: 'manual', label: '사용 설명서' },
      { sep: true },
      { id: 'quit', label: '전체 종료' },
    ],
  });
  switch (id) {
    case 'settings':
      ctx.settings.open();
      break;
    case 'manual':
      openManual();
      break;
    case 'quit':
      quitApp();
      break;
    default:
      break;
  }
});

// 설정 창이 열려 있으면 바탕 화면은 미리 보기라서, 그림 고르기도 설정 창에서
ipcMain.on('track:pick-image', (_e, idx) => { if (!settingsBusy()) chooseImage(idx); });

// 깃발을 누르면 보는 계획(학년) 바꾸기: 1학년 → 2학년 → … → 전체 → 1학년
ipcMain.on('track:flag', () => {
  const d = ctx.data;
  if (d.plans.length < 2) return;
  if (settingsBusy()) return; // 설정 창에서 학년을 고치는 중에는 미리 보기와 헷갈리지 않게
  const order = [...d.plans.map((p) => p.id), VIEW_ALL];
  const next = order[(order.indexOf(d.view_plan) + 1) % order.length];
  commit(() => { d.view_plan = next; d.flag_hint_seen = true; });
  // 진도창이 열려 있으면: 그 반이 안 보이게 되면 닫고, 계속 보이면 캐릭터 새 자리로 옮김
  const p = ctx.progress;
  if (p && p.isOpen()) {
    const cls = d.classes[p.classIdx];
    if (!cls || (next !== VIEW_ALL && cls.plan_id !== next)) p.close();
    else if (ctx.track && !ctx.track.isDestroyed()) ctx.track.webContents.send('track:rect-request', p.classIdx);
  }
});

ipcMain.on('track:rect', (_e, idx, rect) => {
  if (ctx.progress && ctx.track && rect) ctx.progress.move(idx, toScreenRect(rect));
});

// 처음 한 번 뜨는 깃발 안내를 닫음 (다시 안 뜨게 저장)
// 새 버전 말풍선: [보기] → 안내 창, [✕] → 이 버전은 다시 안 띄움
ipcMain.on('track:update-open', () => { if (ctx.pendingUpdate) ctx.updater.prompt(ctx.pendingUpdate); });
ipcMain.on('track:update-dismiss', () => {
  if (ctx.pendingUpdate) commit(() => { ctx.data.update_dismissed = ctx.pendingUpdate.version; });
});

const HINT_FIELDS = { start: 'hint_start_seen', use: 'hint_use_seen', flag: 'flag_hint_seen' };
ipcMain.on('track:hint-seen', (_e, kind) => {
  const field = HINT_FIELDS[kind];
  if (field && !ctx.data[field]) commit(() => { ctx.data[field] = true; });
});

let picking = false;
async function chooseImage(idx) {
  if (picking) return;
  const cls = ctx.data.classes[idx];
  if (!cls) return;
  picking = true;
  try {
    const res = await dialog.showOpenDialog({
      title: `${cls.name} 캐릭터 이미지 선택`,
      properties: ['openFile'],
      filters: [{ name: '이미지 (PNG, JPG, WEBP, BMP, GIF)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
    });
    if (res.canceled || !res.filePaths[0]) return;
    const saved = importCharacter(res.filePaths[0]);
    if (ctx.data.classes[idx] !== cls) return;
    cls.custom_image = saved;
    ctx.data.hint_start_seen = true; // 그림을 골랐으니 다음 안내(클릭·우클릭)로
    ctx.saver.flush();
    pushTrack();
  } catch (err) {
    await dialogs.notify('이미지를 쓸 수 없어요', err.message);
  } finally {
    picking = false;
  }
}

// 고른 이미지를 검사하고 데이터 폴더의 characters 로 복사 (기존 버전과 같은 이름 규칙)
function importCharacter(source) {
  const stat = fs.statSync(source);
  const fd = fs.openSync(source, 'r');
  let head;
  try {
    head = Buffer.alloc(Math.min(stat.size, 512 * 1024));
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  checkImage({ name: path.basename(source), byteLength: stat.size, head });
  fs.mkdirSync(ctx.store.characterDir, { recursive: true });
  const dest = path.join(ctx.store.characterDir, `${crypto.randomBytes(4).toString('hex')}_${path.basename(source)}`);
  const temp = `${dest}.tmp`;
  try {
    fs.copyFileSync(source, temp);
    fs.renameSync(temp, dest);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* 없음 */ }
  }
  return dest;
}

// 이미지 문제는 모아서 한 번에 알립니다.
let issueTimer = null;
const pendingIssues = [];
function noteImageIssue(className, message) {
  const key = `${className}: ${message}`;
  if (ctx.imageIssues.has(key)) return;
  ctx.imageIssues.add(key);
  pendingIssues.push(key);
  clearTimeout(issueTimer);
  issueTimer = setTimeout(() => {
    const list = pendingIssues.splice(0).join('\n');
    dialogs.notify('캐릭터 이미지를 불러오지 못했어요', '해당 반은 "+" 자리표시자로 보여요. 눌러서 이미지를 다시 골라 주세요.', null, list);
  }, 800);
}

// ── 시작과 종료 ──
function quitApp() {
  if (ctx.quitting) return;
  ctx.quitting = true;
  if (ctx.saver && ctx.data) ctx.saver.flush();
  app.quit();
}

app.on('before-quit', () => {
  if (!ctx.quitting && ctx.saver && ctx.data) {
    ctx.quitting = true;
    ctx.saver.flush();
  }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* 트랙 창이 없어도 바로 끄지 않음 (quitApp으로만 종료) */ });

async function start() {
  // 두 개가 켜지면 진도가 서로 덮어써지므로 하나만 실행 (옛 Python 버전과도 같은 이름의 뮤텍스)
  // 시작 메뉴의 "사용 설명서"는 --guide 로 실행됨: 이미 켜져 있으면 그쪽에서 설명서 창만 엶
  const wantsGuide = process.argv.includes('--guide');
  // 개발 확인용: JINDO_DEV_SECOND=1 이면 설치된 진도 위젯이 켜져 있어도 따로 실행 (데이터 폴더를 반드시 따로 지정할 때만)
  const devSecond = process.env.JINDO_DEV_SECOND === '1' && Boolean(process.env.JINDO_DATA_DIR);
  if (devSecond) {
    app.setPath('userData', path.join(app.getPath('temp'), 'JindoWidget-dev-userdata'));
  } else if (!app.requestSingleInstanceLock()) {
    if (!wantsGuide) await dialogs.notify('진도 위젯', '진도 위젯이 이미 실행 중이에요.');
    app.exit(0);
    return;
  }
  if (!devSecond && !native.acquireSingleInstance()) {
    await dialogs.notify('진도 위젯', '진도 위젯이 이미 실행 중이에요.');
    app.exit(0);
    return;
  }
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--guide')) openManual();
  });
  if (wantsGuide) app.whenReady().then(() => setTimeout(openManual, 800));
  const loaded = ctx.store.load();
  ctx.data = loaded.data;
  // 이미 캐릭터 그림을 쓰던 선생님(예전 버전에서 넘어온 경우)에게는 처음 안내를 띄우지 않음
  if (!('hint_start_seen' in ctx.data) && ctx.data.classes.some((c) => c.custom_image)) {
    ctx.data.hint_start_seen = true;
    ctx.data.hint_use_seen = true;
  }
  setupSaver();
  ctx.progress = createProgressWindow({
    ctx,
    commit,
    commitPlan,
    undo,
    saveNow: () => ctx.saver.flush(),
    scheduleSave: () => ctx.saver.schedule(),
    status: () => ctx.saver.status,
    editPlan: (planId, lesson) => ctx.settings.open('plan', { planId, lesson }),
  });
  ctx.updater = createUpdater({
    quitApp,
    saveNow: () => ctx.saver.flush(),
    onAvailable: (upd) => { ctx.pendingUpdate = upd; pushTrack(); }, // 바탕 화면 말풍선으로 알림
  });
  ctx.settings = createSettingsWindow({ ctx, pushTrack, importCharacter, afterChange, replaceData, checkUpdate: () => ctx.updater.check(true) });
  autostart.repair().catch(() => {});
  // 시작하고 잠시 뒤 한 번 업데이트 확인 (새 버전이 있을 때만 알림). 개발 중에는 JINDO_UPDATE_TEST=1 일 때만.
  // 켜고 15초 뒤 한 번, 그다음 6시간마다 (켜 둔 채로 며칠 지나도 알 수 있게)
  if (app.isPackaged || process.env.JINDO_UPDATE_TEST) {
    setTimeout(() => ctx.updater.check(false), 15000);
    setInterval(() => ctx.updater.check(false), 6 * 60 * 60 * 1000);
  }
  createTrack();

  screen.on('display-metrics-changed', placeTrack);
  screen.on('display-added', placeTrack);
  screen.on('display-removed', placeTrack);

  // Ctrl+Shift+Q 로 종료 (Caps Lock 상태와 상관없음)
  globalShortcut.register('Control+Shift+Q', quitApp);

  if (loaded.warning) dialogs.notify('저장 파일 안내', loaded.warning);

  // 처음 설치했을 때: 기본값을 바로 저장해 둠. 안내는 바탕 화면 말풍선("+"를 눌러 그림 고르기)으로 보여 줌
  if (loaded.isFresh) {
    ctx.saver.flush();
    // 처음 설치했을 때는 자동 실행을 켜 둠 (설정 → 위젯에서 끌 수 있음). 이미 쓰던 선생님의 설정은 건드리지 않음
    if (autostart.supported()) autostart.setEnabled(true).catch(() => {});
  }

  // 개발 확인용: JINDO_OPEN_WINDOW=settings|settings:plan|settings:widget|update-check|manual
  const [devName, devTab] = String(process.env.JINDO_OPEN_WINDOW || '').split(':');
  const devWindow = {
    settings: { open: () => ctx.settings.open(devTab) },
    'update-check': { open: () => ctx.updater.check(true) },
    manual: { open: openManual },
  }[devName];
  if (devWindow) setTimeout(() => devWindow.open(), 1500);

  // 개발 확인용: JINDO_OPEN_PROGRESS=반번호(0부터) 이면 시작 후 그 반 진도창을 엽니다.
  if (process.env.JINDO_OPEN_PROGRESS !== undefined) {
    const idx = Number(process.env.JINDO_OPEN_PROGRESS) || 0;
    ctx.track.webContents.once('did-finish-load', () => setTimeout(async () => {
      const r = await ctx.track.webContents.executeJavaScript(
        `(() => { const r = chars[${idx}].root.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
      ctx.progress.open(idx, toScreenRect(r));
    }, 1500));
  }
}

app.whenReady().then(start);
