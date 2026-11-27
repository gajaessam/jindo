'use strict';
// "설정" 창 하나: 반 · 학년 / 수업 계획 / 위젯
// 반·학년·수업 계획·보기는 초안(draft)으로 고치고 "저장"으로 한꺼번에 적용합니다. (바꾸는 동안 바탕 화면에 미리 보기)
// 위젯 탭의 자동 실행·업데이트 확인·백업 복원은 누르는 즉시 동작합니다.

const fs = require('fs');
const { app: electronApp, ipcMain, dialog, screen } = require('electron');
const { describeDisplays } = require('../core/display-pick');
const { openPanel, getPanel } = require('./panel');
const dialogs = require('./dialogs');
const autostart = require('./autostart');
const { cloneData, PLAN_COLORS, MAX_PLANS, MAX_CLASSES } = require('../core/data');
const { planChangedSince } = require('../core/plan-merge');
const { draftFromData, applySettingsDraft, settingsWarnings } = require('../core/settings-draft');
const { sniffImage, MAX_IMAGE_BYTES } = require('../core/image-info');

const KEY = 'settings';
const TABS = ['classes', 'plan', 'widget'];

function createSettingsWindow(app) {
  // app: { ctx, pushTrack, importCharacter, afterChange, replaceData, checkUpdate }
  const { ctx } = app;
  let draft = null;
  let openedPlans = null;
  let knownImages = new Set();
  let lastTab = 'classes';
  let focus = null; // { planId, lesson } 진도창의 "차시·활동 고치기"로 열 때 보여 줄 학년·차시

  ctx.previewData = () => {
    if (!draft) return null;
    try {
      return applySettingsDraft(ctx.data, draft);
    } catch {
      return null;
    }
  };

  function fromWin(event) {
    const win = getPanel(KEY);
    return win && event.sender === win.webContents ? win : null;
  }

  function isOpen() {
    return Boolean(getPanel(KEY));
  }

  function open(tab, where) {
    if (TABS.includes(tab)) lastTab = tab;
    focus = where || null;
    const existing = getPanel(KEY);
    if (existing) {
      if (tab) existing.webContents.send('settings:goto', lastTab, focus);
      existing.show();
      existing.focus();
      return;
    }
    const win = openPanel(KEY, { file: 'hub.html', width: 800, title: '진도 위젯 설정' });
    if (!win) return;
    // 진도창은 닫음: 설정 창이 열려 있는 동안 바탕 화면은 미리 보기라서, 진도창과 내용이 달라 헷갈림
    if (ctx.progress && ctx.progress.isOpen()) ctx.progress.close();
    draft = draftFromData(ctx.data);
    openedPlans = cloneData(ctx.data.plans);
    knownImages = new Set(ctx.data.classes.map((c) => c.custom_image).filter(Boolean));
    win.on('closed', () => {
      draft = null;
      openedPlans = null;
      app.pushTrack(); // "닫기"면 원래대로
    });
  }

  function close() {
    const win = getPanel(KEY);
    if (win) win.close();
  }

  function displayList() {
    return describeDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  }

  // 설정 창이 열려 있는 동안 모니터를 꽂거나 빼면 목록을 새로
  function displaysChanged() {
    const win = getPanel(KEY);
    if (win) win.webContents.send('settings:displays', displayList());
  }

  ipcMain.handle('settings:init', async (event) => {
    if (!fromWin(event) || !draft) return null;
    return {
      draft,
      tab: lastTab,
      focus,
      colors: PLAN_COLORS,
      maxPlans: MAX_PLANS,
      maxClasses: MAX_CLASSES,
      version: electronApp.getVersion(),
      displays: displayList(),
      autostart: { supported: autostart.supported(), on: await autostart.isEnabled().catch(() => false) },
    };
  });

  ipcMain.on('settings:tab', (event, tab) => {
    if (fromWin(event) && TABS.includes(tab)) lastTab = tab;
  });

  // 화면이 바꾼 초안 전체를 받아서 미리 보기
  ipcMain.handle('settings:draft', (event, next) => {
    if (!fromWin(event) || !draft || !next || !Array.isArray(next.classes) || !Array.isArray(next.plans)) return false;
    draft = {
      classes: next.classes.slice(0, MAX_CLASSES).map((c) => ({
        src: Number.isInteger(c.src) && c.src >= 0 && c.src < ctx.data.classes.length ? c.src : null,
        name: String(c.name ?? '').slice(0, 40),
        custom_image: knownImages.has(c.custom_image) ? c.custom_image : null,
        plan_id: String(c.plan_id ?? ''),
      })),
      plans: next.plans,
      reassign: next.reassign && typeof next.reassign === 'object' ? next.reassign : {},
      scale: next.scale,
      float: Boolean(next.float),
      labels: Boolean(next.labels),
      monitor: next.monitor && typeof next.monitor === 'object' ? next.monitor : null,
    };
    app.pushTrack();
    return true;
  });

  ipcMain.handle('settings:pick-image', async (event, className) => {
    const win = fromWin(event);
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: `${className || '반'} 캐릭터 이미지 선택`,
      properties: ['openFile'],
      filters: [{ name: '이미지 (PNG, JPG, WEBP, BMP, GIF)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    try {
      const saved = app.importCharacter(res.filePaths[0]);
      knownImages.add(saved);
      return saved;
    } catch (err) {
      await dialogs.notify('이미지를 쓸 수 없어요', err.message, win);
      return null;
    }
  });

  // 미리 보기 그림: 이 창에서 알고 있는 파일만 읽어 줍니다.
  ipcMain.handle('settings:image', async (event, file) => {
    if (!fromWin(event) || !file || !knownImages.has(file)) return null;
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size > MAX_IMAGE_BYTES) return null;
      const bytes = await fs.promises.readFile(file);
      const info = sniffImage(bytes.subarray(0, 512 * 1024));
      return { bytes, mime: info ? info.mime : 'image/png' };
    } catch {
      return null;
    }
  });

  ipcMain.handle('settings:confirm', async (event, opts) => {
    const win = fromWin(event);
    if (!win) return false;
    return dialogs.confirm({ ...opts, parent: win });
  });

  ipcMain.handle('settings:save', async (event) => {
    const win = fromWin(event);
    if (!win || !draft) return false;
    let preview;
    try {
      preview = applySettingsDraft(ctx.data, draft);
    } catch (err) {
      await dialogs.notify('설정 저장', err.message, win);
      return false;
    }
    const { removed, losing } = settingsWarnings(ctx.data, draft);
    const lines = [];
    if (removed.length) lines.push(`${removed.join(', ')}의 진도와 메모가 지워져요.`);
    if (losing.length) lines.push(`${losing.join(', ')}은(는) 다른 학년으로 바뀌면서 지금까지의 체크가 지워져요.`);
    if (lines.length) {
      const ok = await dialogs.confirm({ title: '설정 저장', message: `${lines.join('\n')}\n계속할까요?`, yes: '저장', danger: true, parent: win });
      if (!ok || !draft) return false;
    }
    if (openedPlans && planChangedSince(openedPlans, ctx.data.plans)) {
      const ok = await dialogs.confirm({
        title: '설정 저장',
        message: '이 창을 연 뒤 진도창에서 차시나 활동이 바뀌었어요.\n설정 창의 수업 계획으로 덮어쓸까요?\n(체크한 내용은 활동을 따라 그대로 남아요)',
        yes: '덮어쓰기', parent: win,
      });
      if (!ok || !draft) return false;
    }
    const sameClasses = draft.classes.length === ctx.data.classes.length
      && draft.classes.every((d, i) => d.src === i && d.plan_id === ctx.data.classes[i].plan_id);
    const snapshot = cloneData(ctx.data);
    try {
      preview = applySettingsDraft(ctx.data, draft); // 확인 창을 기다리는 동안 바뀐 체크까지 반영
    } catch (err) {
      await dialogs.notify('설정 저장', err.message, win);
      return false;
    }
    for (const key of Object.keys(ctx.data)) delete ctx.data[key];
    Object.assign(ctx.data, preview);
    // 설정 창에서 캐릭터 그림을 골랐으면 처음 안내("+"를 눌러 그림 고르기)는 끝난 것으로
    if (!ctx.data.hint_start_seen && ctx.data.classes.some((c) => c.custom_image)) ctx.data.hint_start_seen = true;
    ctx.undo = sameClasses ? snapshot : null; // 반 구성이 그대로일 때만 진도창 되돌리기 가능
    if (ctx.progress && ctx.progress.isOpen() && (!sameClasses || ctx.progress.classIdx >= ctx.data.classes.length)) ctx.progress.close();
    draft = null;
    app.afterChange();
    win.close();
    return true;
  });

  ipcMain.on('settings:close', (event) => {
    if (fromWin(event)) close();
  });

  // ── 위젯 탭 (즉시 동작하는 것들) ──
  ipcMain.handle('settings:autostart', async (event, on) => {
    const win = fromWin(event);
    if (!win) return null;
    try {
      return await autostart.setEnabled(Boolean(on));
    } catch (err) {
      await dialogs.notify('자동 실행', err.message, win);
      return autostart.isEnabled().catch(() => false);
    }
  });

  ipcMain.on('settings:update-check', (event) => {
    if (fromWin(event)) app.checkUpdate();
  });

  ipcMain.handle('settings:backups', (event) => (fromWin(event)
    ? ctx.store.listBackups().map((e) => ({
      name: e.name, savedText: e.savedText, beforeRestore: e.beforeRestore, beforeUpgrade: e.beforeUpgrade,
      classes: e.classes, plans: e.plans, activities: e.activities, checks: e.checks,
    }))
    : []));

  ipcMain.handle('settings:restore', async (event, name) => {
    const win = fromWin(event);
    if (!win) return false;
    const entry = ctx.store.listBackups().find((e) => e.name === name);
    if (!entry) {
      await dialogs.notify('백업에서 복원', '그 백업을 찾을 수 없어요.', win);
      return false;
    }
    const ok = await dialogs.confirm({
      title: '백업에서 복원',
      message: `${entry.savedText} 상태로 되돌릴까요?\n(${entry.classes}개 반 · ${entry.plans > 1 ? `학년 ${entry.plans}개 · ` : ''}활동 ${entry.activities}개 · 체크 ${entry.checks}개)\n\n지금 상태는 "(복원 직전)"으로 보관돼서, 이 복원도 다시 되돌릴 수 있어요.\n설정 창에서 저장하지 않은 내용은 버려져요.`,
      yes: '복원하기', parent: win,
    });
    if (!ok) return false;
    try {
      ctx.saver.flush();
      const restored = ctx.store.restore(entry, ctx.data);
      draft = null;
      win.close();
      app.replaceData(restored);
    } catch (err) {
      await dialogs.notify('복원하지 못했어요', err.message, getPanel(KEY));
      return false;
    }
    await dialogs.notify('백업에서 복원', `${entry.savedText} 상태로 복원했어요.`);
    return true;
  });

  return { open, close, isOpen, displaysChanged };
}

module.exports = { createSettingsWindow };
