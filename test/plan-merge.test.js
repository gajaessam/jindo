'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/data');
const { planChangedSince, applyEditedPlans, cleanPlans } = require('../src/core/plan-merge');

function sample() {
  return D.normalizeData({
    classes: [{ name: '1반', progress: [[false, false, false], [false]] }, { name: '2반', progress: [[true, false, false], [true]] }],
    plan: [
      { name: '1차시', items: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] },
      { name: '2차시', items: [{ text: 'D' }] },
    ],
    lesson: { 0: 1, 1: 0 },
  });
}
const lessons0 = (d) => d.plans[0].lessons;

test('설정 창을 연 뒤 진도창에서 한 체크는 저장해도 지워지지 않는다', () => {
  const live = sample();
  const edited = D.cloneData(live.plans);
  edited[0].lessons[0].items.push({ text: '새 활동' });
  live.classes[0].progress[0][1] = true;
  assert.equal(planChangedSince(D.cloneData(live.plans), live.plans), false, '체크만으로는 계획이 바뀐 게 아님');
  const out = applyEditedPlans(live, edited);
  assert.deepEqual(out.classes[0].progress, [[false, true, false, false], [false]]);
  assert.deepEqual(out.classes[1].progress, [[true, false, false, false], [true]]);
});

test('순서를 바꾸면 체크가 해당 활동을 따라간다', () => {
  const live = sample();
  const edited = D.cloneData(live.plans);
  edited[0].lessons[0].items.reverse();
  edited[0].lessons.reverse();
  const out = applyEditedPlans(live, edited);
  assert.deepEqual(lessons0(out).map((l) => l.name), ['2차시', '1차시']);
  assert.deepEqual(out.classes[1].progress, [[true], [false, false, true]]);
  assert.deepEqual(out.lesson, { 0: 0, 1: 1 });
});

test('지운 활동의 체크는 사라지고 이름을 바꿔도 체크는 유지', () => {
  const live = sample();
  const edited = D.cloneData(live.plans);
  edited[0].lessons[0].items[0].text = 'A(수정)';
  edited[0].lessons[0].items.splice(1, 1);
  const out = applyEditedPlans(live, edited);
  assert.deepEqual(lessons0(out)[0].items.map((i) => i.text), ['A(수정)', 'C']);
  assert.deepEqual(out.classes[1].progress[0], [true, false]);
});

test('활동을 다른 차시로 옮겨도 체크가 따라간다', () => {
  const live = sample();
  const edited = D.cloneData(live.plans);
  const [a] = edited[0].lessons[0].items.splice(0, 1);
  edited[0].lessons[1].items.push(a);
  const out = applyEditedPlans(live, edited);
  assert.deepEqual(out.classes[1].progress, [[false, false], [true, true]]);
});

test('계획 추가: 기존 반은 그대로, 새 계획은 아무도 안 따라감', () => {
  const live = sample();
  const edited = D.cloneData(live.plans);
  edited.push({ id: 'p2', name: '2학년', lessons: [{ name: '1차시', items: [{ text: 'Z' }] }] });
  const out = applyEditedPlans(live, edited);
  assert.equal(out.plans.length, 2);
  assert.ok(out.classes.every((c) => c.plan_id === 'p1'));
  assert.deepEqual(out.classes[1].progress, live.classes[1].progress);
});

test('계획 삭제: 그 계획의 반은 옮길 계획으로, 체크는 새로 시작, 보던 차시는 1차시', () => {
  const live = D.normalizeData({
    classes: [{ name: '1-1', plan_id: 'g1', progress: [[true]] }, { name: '2-1', plan_id: 'g2', progress: [[true], [true]] }],
    plans: [
      { id: 'g1', name: '1학년', lessons: [{ name: '1차시', items: [{ text: 'A' }] }] },
      { id: 'g2', name: '2학년', lessons: [{ name: '1차시', items: [{ text: 'X' }] }, { name: '2차시', items: [{ text: 'Y' }] }] },
    ],
    lesson: { 1: 1 },
    view_plan: 'g2',
  });
  const edited = D.cloneData(live.plans).filter((p) => p.id !== 'g2');
  const out = applyEditedPlans(live, edited, { g2: 'g1' });
  assert.equal(out.plans.length, 1);
  assert.equal(out.classes[1].plan_id, 'g1');
  assert.deepEqual(out.classes[1].progress, [[false]]);
  assert.deepEqual(out.classes[0].progress, [[true]], '남은 계획의 반은 그대로');
  assert.deepEqual(out.lesson, { 1: 0 });
  assert.equal(out.view_plan, 'all', '보던 계획이 사라지면 전체로');
});

test('보던 차시가 지워지면 범위 안으로, 계획·차시가 비면 거부', () => {
  const live = sample();
  const edited = D.cloneData(live.plans);
  edited[0].lessons = edited[0].lessons.slice(0, 1);
  assert.deepEqual(applyEditedPlans(live, edited).lesson, { 0: 0, 1: 0 });
  assert.throws(() => applyEditedPlans(live, []));
  const noLesson = D.cloneData(live.plans);
  noLesson[0].lessons = [];
  assert.throws(() => applyEditedPlans(live, noLesson));
});

test('진도창에서 계획 자체가 바뀌면 알아챈다', () => {
  const live = sample();
  const opened = D.cloneData(live.plans);
  assert.equal(planChangedSince(opened, live.plans), false);
  live.plans[0].lessons[0].items.push({ text: '진도창에서 추가', _uid: D.newUid() });
  assert.equal(planChangedSince(opened, live.plans), true);
  const live2 = sample();
  const opened2 = D.cloneData(live2.plans);
  const items = live2.plans[0].lessons[0].items;
  [items[0], items[1]] = [items[1], items[0]];
  assert.equal(planChangedSince(opened2, live2.plans), true, '순서 변경도 계획 변경');
});

test('덮어쓰기로 결정해도 진도창에서 옮긴 활동의 체크는 따라간다', () => {
  const live = sample();
  const edited = D.cloneData(live.plans);
  const items = live.plans[0].lessons[0].items;
  const [c] = items.splice(2, 1);
  items.unshift(c);
  live.classes.forEach((cls) => { const [m] = cls.progress[0].splice(2, 1); cls.progress[0].unshift(m); });
  live.classes[0].progress[0][0] = true;
  const out = applyEditedPlans(live, edited);
  assert.deepEqual(lessons0(out)[0].items.map((i) => i.text), ['A', 'B', 'C']);
  assert.deepEqual(out.classes[0].progress[0], [false, false, true]);
});

test('설정 창에서 받은 계획 정리: 빈 이름 채우기, 꼬리표 유지, id 겹침 정리, 빈 계획 거부', () => {
  const out = cleanPlans([{ id: 'p1', name: '  ', lessons: [{ name: ' ', items: [{ text: '', _uid: 'u1' }, { text: ' 발표  하기 ' }], _uid: 'L1' }] }]);
  assert.deepEqual(out, [{ id: 'p1', name: '1학년', lessons: [{ name: '1차시', items: [{ text: '활동', _uid: 'u1' }, { text: '발표 하기' }], _uid: 'L1' }] }]);
  const two = cleanPlans([{ id: 'p1', name: '가', lessons: [] }, { id: 'p1', name: '', lessons: [] }]);
  assert.notEqual(two[0].id, two[1].id);
  assert.equal(two[1].name, '2학년');
  assert.deepEqual(two[0].lessons.map((l) => l.name), ['1차시'], '차시가 없으면 1차시를 만듦');
  assert.throws(() => cleanPlans([]), /하나 이상/);
  assert.throws(() => cleanPlans(null));
  assert.throws(() => cleanPlans(Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: 'x', lessons: [] }))), /6개까지/);
});

test('수업 계획 설정에서 반의 학년 정하기: 바뀐 반만 체크가 처음부터, 체크가 있던 반 이름을 알려 줌', () => {
  const { assignClasses } = require('../src/core/plan-merge');
  const live = sample();
  const edited = D.cloneData(live.plans);
  edited.push({ id: 'p2', name: '2학년', lessons: [{ name: '1차시', items: [{ text: 'Z' }, { text: 'W' }] }] });
  const applied = applyEditedPlans(live, edited);
  const { data, losing } = assignClasses(applied, ['p1', 'p2']);
  assert.deepEqual(losing, ['2반'], '2반은 체크가 있었음');
  assert.equal(data.classes[0].plan_id, 'p1');
  assert.deepEqual(data.classes[0].progress, applied.classes[0].progress, '그대로인 반은 체크 유지');
  assert.equal(data.classes[1].plan_id, 'p2');
  assert.deepEqual(data.classes[1].progress, [[false, false]]);
  assert.deepEqual(data.lesson, { 0: 1 }, '학년이 바뀐 반의 보던 차시는 지움');
  assert.equal(applied.classes[1].plan_id, 'p1', '원래 data는 그대로');
  assert.deepEqual(assignClasses(applied, ['p1']).losing, [], '반 수가 다르면 무시');
  assert.equal(assignClasses(applied, ['p1', 'nope']).data.classes[1].plan_id, 'p1', '없는 학년은 무시');
});

test('적용 결과는 원래 data를 바꾸지 않는다', () => {
  const live = sample();
  const snapshot = JSON.stringify(live);
  const edited = D.cloneData(live.plans);
  edited[0].lessons.reverse();
  applyEditedPlans(live, edited);
  assert.equal(JSON.stringify(live), snapshot);
});
