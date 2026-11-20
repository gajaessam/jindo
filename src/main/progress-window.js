'use strict';
// 진도창: 캐릭터를 왼쪽 클릭하면 그 캐릭터 위에 뜨는 말풍선 창

const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const A = require('../core/actions');
const { completion, lessonCompletion, planOf, planColor } = require('../core/data');
const dialogs = require('./dialogs');

const WIDTH = 384; // 카드 352 + 양옆 그림자 여백

function createProgressWindow(app) {
  // app: { ctx, commit(fn), commitPlan(fn), undo(), saveNow(), scheduleSave(), status() }
  const { ctx } = app;
  let win = null;
  let classIdx = -1;
  let anchor = null; // { bottom, centerX }
  let shown = false;
  let busy = false;

  function isOpen() {
    return Boolean(win && !win.isDestroyed());
  }

  function view() {
    const d = ctx.data;
    const li = A.currentLesson(d, classIdx);
    const plan = planOf(d, classIdx);
    const lesson = plan.lessons[li];
    const marks = d.classes[classIdx].progress[li];
    const lc = lessonCompletion(d, classIdx, li);
    const wa = screen.getDisplayNearestPoint({ x: Math.round(anchor.centerX), y: Math.round(anchor.bottom) }).workArea;
    return {
      classIdx,
      className: d.classes[classIdx].name,
      lessonIdx: li,
      lessonCount: plan.lessons.length,
      planName: d.plans.length > 1 ? plan.name : '',
      planColor: planColor(d, plan.id),
      lessonName: lesson.name,
      items: lesson.items.map((item, i) => ({ text: item.text, done: Boolean(marks[i]) })),
      done: lc.done,
      total: lc.total,
      percent: lc.percent,
      overall: completion(d, classIdx),
      memo: d.classes[classIdx].memo,
      status: app.status(),
      maxHeight: Math.max(320, Math.floor(anchor.bottom - wa.y - 4)),
    };
  }

  function refresh() {
    if (!isOpen()) return;
    if (classIdx >= ctx.data.classes.length) { close(); return; }
    win.webContents.send('progress:view', view());
  }

  function sendStatus(status) {
    if (isOpen()) win.webContents.send('progress:status', status);
  }

  // 말풍선 위치: 캐릭터 바로 위, 꼬리가 캐릭터를 가리키도록
  function place(height) {
    const wa = screen.getDisplayNearestPoint({ x: Math.round(anchor.centerX), y: Math.round(anchor.bottom) }).workArea;
    const h = Math.max(200, Math.min(Math.round(height), Math.floor(anchor.bottom - wa.y)));
    let x = Math.round(anchor.centerX - WIDTH / 2);
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - WIDTH));
    const y = Math.round(anchor.bottom - h);
    win.setBounds({ x, y: Math.max(wa.y, y), width: WIDTH, height: h });
    win.webContents.send('progress:tail', Math.round(anchor.centerX - x));
  }

  function create() {
    win = new BrowserWindow({
      width: WIDTH,
      height: 480,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      title: '진도창',
      webPreferences: {
        preload: path.join(__dirname, 'preload-progress.js'),
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });
    win.removeMenu();
    shown = false;
    win.on('closed', () => {
      win = null;
      classIdx = -1;
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'progress.html'));
  }

  // rect: 화면 좌표의 캐릭터(이름표 포함) 영역
  function open(idx, rect) {
    if (isOpen() && idx === classIdx) { close(); return; } // 같은 캐릭터를 다시 누르면 닫기
    app.saveNow(); // 다른 반을 열 때 메모 등은 바로 저장
    classIdx = idx;
    anchor = { bottom: rect.y - 2, centerX: rect.x + rect.width / 2 };
    if (!isOpen()) create();
    else refresh();
    if (shown) win.focus();
  }

  function close() {
    if (!isOpen()) return;
    app.saveNow();
    win.close();
  }

  function fromWin(event) {
    return isOpen() && event.sender === win.webContents;
  }

  ipcMain.handle('progress:get', (event) => (fromWin(event) ? view() : null));

  ipcMain.on('progress:ready', (event, height) => {
    if (!fromWin(event)) return;
    place(height);
    if (!shown) {
      shown = true;
      win.show();
      win.focus();
    }
  });

  ipcMain.on('progress:memo', (event, text) => {
    if (!fromWin(event)) return;
    A.setMemo(ctx.data, classIdx, text);
    app.scheduleSave();
  });

  ipcMain.on('progress:memo-flush', (event) => {
    if (fromWin(event)) app.saveNow();
  });

  ipcMain.on('progress:action', async (event, name, arg = {}) => {
    if (!fromWin(event) || busy) return;
    const d = ctx.data;
    const ci = classIdx;
    const li = A.currentLesson(d, ci);
    const plan = planOf(d, ci);
    const pid = plan.id;
    busy = true;
    try {
      switch (name) {
        case 'close':
          close();
          break;
        case 'toggle':
          app.commit(() => A.toggleItem(ctx.data, ci, li, arg.item));
          break;
        case 'lesson':
          app.commit(() => A.setLesson(ctx.data, ci, li + (arg.delta > 0 ? 1 : -1)));
          break;
        case 'editPlan':
          // 차시·활동 고치기는 설정 → 수업 계획에서 (이 반의 학년, 이 차시가 보이게)
          close();
          app.editPlan(pid, li);
          break;        default:
          break;
      }
    } catch (err) {
      dialogs.notify('진도창', err.message, isOpen() ? win : null);
    } finally {
      busy = false;
    }
  });

  return { open, close, refresh, sendStatus, isOpen, get classIdx() { return classIdx; }, get window() { return win; } };
}

module.exports = { createProgressWindow };
