'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/data');
const S = require('../src/core/settings-draft');

function sample() {
  return D.normalizeData({
    classes: [
      { name: '5반', plan_id: 'g2', progress: [[true, false]], memo: '오반' },
      { name: '6반', plan_id: 'g2', progress: [[false, false]] },
      { name: '9반', plan_id: 'g1', progress: [[true]], memo: '구반' },
    ],
    plans: [
      { id: 'g2', name: '2학년', lessons: [{ name: '1차시', items: [{ text: 'A' }, { text: 'B' }] }] },
      { id: 'g1', name: '1학년', lessons: [{ name: '1차시', items: [{ text: 'X' }] }] },
    ],
    lesson: { 0: 0, 2: 0 },
  });
}

test('초안을 그대로 적용하면 데이터가 바뀌지 않는다', () => {
  const d = sample();
  assert.deepEqual(D.toFileData(S.applySettingsDraft(d, S.draftFromData(d))), D.toFileData(d));
});

test('보기 설정: 크기 10% 단위, 대기 동작, 진도율 표시', () => {
  const d = sample();
  const draft = S.draftFromData(d);
  Object.assign(draft, { scale: 133, float: true, labels: false });
  const out = S.applySettingsDraft(d, draft);
  assert.equal(out.character_scale, 130);
  assert.equal(out.float_motion, true);
  assert.equal(out.show_progress_labels, false);
});

test('학년 안에 반 추가: 그 학년으로 생기고 이름은 다음 번호', () => {
  const d = sample();
  const draft = S.draftFromData(d);
  draft.classes.push({ src: null, name: S.nextClassName(draft.classes), custom_image: null, plan_id: 'g1' });
  assert.equal(draft.classes[3].name, '10반');
  const out = S.applySettingsDraft(d, draft);
  assert.equal(out.classes[3].plan_id, 'g1');
  assert.deepEqual(out.classes[3].progress, [[false]]);
  assert.equal(out.classes[0].memo, '오반', '기존 반은 그대로');
});

test('가운데 반 지우기: 나머지 반의 진도·메모·보던 차시가 제자리를 따라간다', () => {
  const d = sample();
  const draft = S.draftFromData(d);
  draft.classes.splice(1, 1); // 6반 삭제
  assert.deepEqual(S.settingsWarnings(d, draft).removed, ['6반']);
  const out = S.applySettingsDraft(d, draft);
  assert.deepEqual(out.classes.map((c) => c.name), ['5반', '9반']);
  assert.equal(out.classes[1].memo, '구반');
  assert.deepEqual(out.classes[1].progress, [[true]]);
  assert.deepEqual(out.lesson, { 0: 0, 1: 0 }, '9반의 보던 차시 번호가 새 자리(1)로');
});

test('반을 다른 학년으로 옮기면 체크가 처음부터, 저장 전에 알려 줌', () => {
  const d = sample();
  const draft = S.draftFromData(d);
  draft.classes[0].plan_id = 'g1';
  draft.classes[1].plan_id = 'g1';
  assert.deepEqual(S.settingsWarnings(d, draft).losing, ['5반'], '체크가 있던 반만');
  const out = S.applySettingsDraft(d, draft);
  assert.equal(out.classes[0].plan_id, 'g1');
  assert.deepEqual(out.classes[0].progress, [[false]]);
  assert.equal(out.classes[0].memo, '오반', '메모는 그대로');
  assert.equal('0' in out.lesson, false);
});

test('학년 추가와 차시 편집을 반 옮기기와 한 번에 적용', () => {
  const d = sample();
  const draft = S.draftFromData(d);
  draft.plans.push({ id: 'g3', name: '3학년', lessons: [{ name: '1차시', items: [{ text: 'Q' }, { text: 'R' }, { text: 'S' }] }] });
  draft.plans[0].lessons[0].items.push({ text: 'C' });
  draft.classes[1].plan_id = 'g3';
  const out = S.applySettingsDraft(d, draft);
  assert.equal(out.plans.length, 3);
  assert.deepEqual(out.classes[0].progress, [[true, false, false]], '2학년에 활동 추가, 체크 유지');
  assert.equal(out.classes[1].plan_id, 'g3');
  assert.deepEqual(out.classes[1].progress, [[false, false, false]]);
});

test('학년 삭제: 그 학년 반은 옮겨 가고 경고에 나옴', () => {
  const d = sample();
  const draft = S.draftFromData(d);
  draft.plans = draft.plans.filter((p) => p.id !== 'g1');
  draft.reassign = { g1: 'g2' };
  draft.classes[2].plan_id = 'g2';
  assert.deepEqual(S.settingsWarnings(d, draft).losing, ['9반']);
  const out = S.applySettingsDraft(d, draft);
  assert.equal(out.plans.length, 1);
  assert.equal(out.classes[2].plan_id, 'g2');
  assert.deepEqual(out.classes[2].progress, [[false, false]]);
});

test('창을 연 뒤 진도창에서 한 체크는 저장해도 남는다', () => {
  const d = sample();
  const draft = S.draftFromData(d);
  d.classes[1].progress[0][1] = true;
  draft.classes[1].name = '6반(수정)';
  const out = S.applySettingsDraft(d, draft);
  assert.deepEqual(out.classes[1].progress, [[false, true]]);
  assert.equal(out.classes[1].name, '6반(수정)');
});

test('반은 1~20개, 원래 data는 그대로', () => {
  const d = sample();
  const snapshot = JSON.stringify(d);
  const draft = S.draftFromData(d);
  draft.classes = [];
  assert.throws(() => S.applySettingsDraft(d, draft), /하나 이상/);
  draft.classes = Array.from({ length: 21 }, (_, i) => ({ src: null, name: `${i}반`, plan_id: 'g1' }));
  assert.throws(() => S.applySettingsDraft(d, draft), /20개/);
  assert.equal(JSON.stringify(d), snapshot);
});
