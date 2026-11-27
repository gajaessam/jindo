'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMonitor, pickDisplay, describeDisplays, sameMonitor } = require('../src/core/display-pick');
const { freshData, normalizeData } = require('../src/core/data');
const { draftFromData, applySettingsDraft } = require('../src/core/settings-draft');

function disp(id, label, x, y = 0, width = 1920, height = 1080) {
  return { id, label, bounds: { x, y, width, height }, workArea: { x, y, width, height: height - 48 } };
}
const LEFT = disp(11, 'DELL U2419H', 0);
const RIGHT = disp(22, 'LG 24MK', 1920);

test('저장 값 정리: 이상한 값은 null(주 모니터)', () => {
  assert.equal(normalizeMonitor(null), null);
  assert.equal(normalizeMonitor('x'), null);
  assert.equal(normalizeMonitor({ id: 'a', x: 0, y: 0 }), null);
  assert.deepEqual(normalizeMonitor({ id: 22, label: 'LG', x: 1920.4, y: 0, extra: 1 }), { id: 22, label: 'LG', x: 1920, y: 0 });
});

test('고른 모니터가 없으면 주 모니터', () => {
  assert.equal(pickDisplay([LEFT, RIGHT], 11, null), LEFT);
  assert.equal(pickDisplay([LEFT, RIGHT], 22, null), RIGHT);
  assert.equal(pickDisplay([LEFT], 11, { id: 22, label: 'LG 24MK', x: 1920, y: 0 }), LEFT); // 모니터를 뺐을 때
});

test('번호 → 이름 → 위치 순서로 고른 모니터를 찾는다', () => {
  const want = { id: 22, label: 'LG 24MK', x: 1920, y: 0 };
  assert.equal(pickDisplay([LEFT, RIGHT], 11, want), RIGHT);
  // 다시 켰더니 번호가 바뀜: 이름으로 찾음
  assert.equal(pickDisplay([disp(5, 'DELL U2419H', 0), disp(6, 'LG 24MK', 1920)], 5, want).id, 6);
  // 이름이 비어 있는 모니터: 위치로 찾음
  assert.equal(pickDisplay([disp(5, '', 0), disp(6, '', 1920)], 5, { id: 99, label: '', x: 1920, y: 0 }).id, 6);
  // 같은 모델 두 대: 이름이 같으면 위치로 구분
  assert.equal(pickDisplay([disp(5, 'DELL', 0), disp(6, 'DELL', 1920)], 5, { id: 99, label: 'DELL', x: 1920, y: 0 }).id, 6);
});

test('설정 창 목록: 왼쪽부터, 둘이면 왼쪽/오른쪽 이름', () => {
  const list = describeDisplays([RIGHT, LEFT], 22);
  assert.deepEqual(list.map((d) => d.name), ['왼쪽 모니터', '오른쪽 모니터']);
  assert.equal(list[1].primary, true);
  assert.match(list[1].detail, /주 모니터/);
  assert.deepEqual(list[0].key, { id: 11, label: 'DELL U2419H', x: 0, y: 0 });
  assert.deepEqual(describeDisplays([LEFT, RIGHT, disp(33, '', 3840)], 11).map((d) => d.name), ['모니터 1', '모니터 2', '모니터 3']);
});

test('데이터: 처음엔 주 모니터, 저장한 모니터는 이어지고 설정 초안으로 바꿀 수 있다', () => {
  assert.equal(freshData().monitor, null);
  const old = freshData();
  delete old.monitor;
  assert.equal(normalizeData(old).monitor, null); // 옛 데이터
  const d = normalizeData({ ...freshData(), monitor: { id: 22, label: 'LG 24MK', x: 1920, y: 0 } });
  assert.ok(sameMonitor(d.monitor, { id: 22, label: 'LG 24MK', x: 1920, y: 0 }));
  const draft = draftFromData(d);
  draft.monitor = null;
  assert.equal(applySettingsDraft(d, draft).monitor, null);
  draft.monitor = { id: 11, label: 'DELL U2419H', x: 0, y: 0 };
  assert.deepEqual(applySettingsDraft(d, draft).monitor, { id: 11, label: 'DELL U2419H', x: 0, y: 0 });
});
