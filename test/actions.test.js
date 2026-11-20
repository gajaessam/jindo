'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/data');
const A = require('../src/core/actions');

function sample() {
  return D.normalizeData({
    classes: [{ name: '1반', progress: [[true, false, false], [false]] }, { name: '2반', progress: [[false, true, false], [true]] }],
    plan: [
      { name: '1차시', items: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] },
      { name: '2차시', items: [{ text: 'D' }] },
    ],
    lesson: { 0: 1, 1: 0 },
  });
}
// 1학년 2개 반(g1) + 2학년 1개 반(g2)
function twoPlans() {
  return D.normalizeData({
    classes: [
      { name: '1-1', plan_id: 'g1', progress: [[true, false]] },
      { name: '1-2', plan_id: 'g1', progress: [[false, true]] },
      { name: '2-1', plan_id: 'g2', progress: [[true], [false]] },
    ],
    plans: [
      { id: 'g1', name: '1학년', lessons: [{ name: '1차시', items: [{ text: 'A' }, { text: 'B' }] }] },
      { id: 'g2', name: '2학년', lessons: [{ name: '1차시', items: [{ text: 'X' }] }, { name: '2차시', items: [{ text: 'Y' }] }] },
    ],
    lesson: { 2: 1 },
  });
}
const P = 'p1';
const texts = (d, l, pid = P) => D.planById(d, pid).lessons[l].items.map((i) => i.text);

test('체크하면 그 반만 바뀌고 진도율이 오른다', () => {
  const d = sample();
  assert.equal(D.completion(d, 0), 25);
  A.toggleItem(d, 0, 0, 1);
  assert.deepEqual(d.classes[0].progress[0], [true, true, false]);
  assert.deepEqual(d.classes[1].progress[0], [false, true, false]);
  assert.equal(D.completion(d, 0), 50);
  A.toggleItem(d, 0, 0, 1, false);
  assert.equal(d.classes[0].progress[0][1], false);
  assert.throws(() => A.toggleItem(d, 0, 0, 9));
});

test('활동 추가·수정: 같은 계획의 모든 반에 같이 생기고 체크는 안 된 상태', () => {
  const d = sample();
  assert.equal(A.addItem(d, P, 1, '  새   활동 '), 1);
  assert.deepEqual(texts(d, 1), ['D', '새 활동']);
  assert.deepEqual(d.classes.map((c) => c.progress[1]), [[false, false], [true, false]]);
  A.editItem(d, P, 1, 1, '고친 활동');
  assert.equal(texts(d, 1)[1], '고친 활동');
  A.editItem(d, P, 1, 1, '   ');
  assert.equal(texts(d, 1)[1], '고친 활동', '빈 이름으로는 안 바뀜');
});

test('다른 계획의 반에는 영향이 없다', () => {
  const d = twoPlans();
  A.addItem(d, 'g1', 0, '새 활동');
  assert.deepEqual(d.classes[0].progress, [[true, false, false]]);
  assert.deepEqual(d.classes[1].progress, [[false, true, false]]);
  assert.deepEqual(d.classes[2].progress, [[true], [false]], '2학년 반은 그대로');
  A.deleteItem(d, 'g2', 0, 0);
  assert.deepEqual(d.classes[2].progress, [[], [false]]);
  assert.deepEqual(d.classes[0].progress, [[true, false, false]], '1학년 반은 그대로');
  A.addLesson(d, 'g1', '');
  assert.equal(D.planById(d, 'g1').lessons[1].name, '2차시');
  assert.equal(d.classes[0].progress.length, 2);
  assert.equal(d.classes[2].progress.length, 2, '2학년은 차시 수 그대로');
});

test('위로·아래로 이동하면 같은 계획 반들의 체크가 같이 따라간다', () => {
  const d = sample();
  assert.equal(A.moveItem(d, P, 0, 0, 1), 1);
  assert.deepEqual(texts(d, 0), ['B', 'A', 'C']);
  assert.deepEqual(d.classes[0].progress[0], [false, true, false]);
  assert.deepEqual(d.classes[1].progress[0], [true, false, false]);
  assert.equal(A.moveItem(d, P, 0, 0, -1), 0, '맨 위에서 위로는 그대로');
});

test('활동 삭제는 같은 계획의 모든 반에서 같이 지워진다', () => {
  const d = sample();
  A.deleteItem(d, P, 0, 0);
  assert.deepEqual(texts(d, 0), ['B', 'C']);
  assert.deepEqual(d.classes.map((c) => c.progress[0]), [[false, false], [true, false]]);
});

test('차시 추가·이름 수정·삭제, 1개뿐이면 삭제 불가', () => {
  const d = sample();
  const li = A.addLesson(d, P, '');
  assert.equal(D.planById(d, P).lessons[li].name, '3차시');
  assert.deepEqual(d.classes[0].progress[li], []);
  A.renameLesson(d, P, li, '평가');
  assert.equal(D.planById(d, P).lessons[li].name, '평가');
  A.deleteLesson(d, P, 0);
  assert.deepEqual(D.planById(d, P).lessons.map((l) => l.name), ['2차시', '평가']);
  assert.deepEqual(d.lesson, { 0: 0, 1: 0 });
  A.deleteLesson(d, P, 1);
  assert.throws(() => A.deleteLesson(d, P, 0), /1개뿐/);
});

test('차시를 지우면 그 계획을 따라가는 반의 "보던 차시"만 맞춰진다', () => {
  const d = twoPlans();
  d.lesson = { 0: 0, 2: 1 };
  A.deleteLesson(d, 'g2', 0);
  assert.deepEqual(d.lesson, { 0: 0, 2: 0 });
});

test('보던 차시 번호가 이상하면 그 반 계획의 범위 안으로', () => {
  const d = sample();
  d.lesson = { 0: 99, 1: 'x' };
  assert.equal(A.currentLesson(d, 0), 1);
  assert.equal(A.currentLesson(d, 1), 0);
  assert.equal(A.currentLesson(d, 5), 0);
  assert.equal(A.setLesson(d, 0, -3), 0);
  const p = twoPlans();
  assert.equal(A.setLesson(p, 0, 5), 0, '1학년 계획은 차시 1개');
  assert.equal(A.setLesson(p, 2, 5), 1, '2학년 계획은 차시 2개');
});

test('되돌리기: 지운 활동과 그 체크가 돌아오고, 그 뒤에 한 체크·메모는 유지', () => {
  const d = sample();
  const snap = D.cloneData(d);
  A.deleteItem(d, P, 0, 0);
  A.toggleItem(d, 0, 0, 1);
  A.setMemo(d, 0, '나중 메모');
  A.undoPlan(d, snap);
  assert.deepEqual(texts(d, 0), ['A', 'B', 'C']);
  assert.deepEqual(d.classes[0].progress[0], [true, false, true]);
  assert.equal(d.classes[0].memo, '나중 메모');
});

test('되돌리기: 순서 변경 취소, 차시 삭제 취소, 다른 계획도 함께 원래대로', () => {
  const d = sample();
  const snap = D.cloneData(d);
  A.moveItem(d, P, 0, 2, -1);
  A.undoPlan(d, snap);
  assert.deepEqual(texts(d, 0), ['A', 'B', 'C']);
  const p = twoPlans();
  const s2 = D.cloneData(p);
  A.deleteLesson(p, 'g2', 1);
  A.undoPlan(p, s2);
  assert.equal(D.planById(p, 'g2').lessons.length, 2);
  assert.deepEqual(p.classes[2].progress, [[true], [false]]);
  assert.deepEqual(p.lesson, { 2: 1 });
});

test('저장해도 파일 형식에 꼬리표가 없고, 다시 읽어도 같다', () => {
  const d = twoPlans();
  A.addItem(d, 'g1', 0, 'X');
  A.addLesson(d, 'g2', 'Y');
  const out = D.toFileData(d);
  assert.ok(!JSON.stringify(out).includes('_uid'));
  assert.deepEqual(D.toFileData(D.normalizeData(out)), out);
});
