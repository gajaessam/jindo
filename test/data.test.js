'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/core/data');

// v0.2.x ~ v1.0.x 형식 (계획 하나)
const OLD_FORMAT = {
  classes: [
    {
      name: '1반',
      image: 0,
      custom_image: 'C:\\Users\\이름\\AppData\\Roaming\\UsagiJindo\\characters\\a1b2c3d4_캐릭터.png',
      progress: [[true, false, false], []],
      memo: '이 반 메모',
    },
  ],
  plan: [
    { name: '1차시', items: [{ text: '활동 1' }, { text: '활동 2' }, { text: '활동 3' }] },
    { name: '2차시', items: [] },
  ],
  lesson: { 0: 1 },
  float_motion: false,
  character_scale: 100,
  show_progress_labels: true,
};

// v1.1 형식 (계획 여러 개)
function twoPlans() {
  return D.normalizeData({
    classes: [
      { name: '1-1', plan_id: 'g1', progress: [[true, false]] },
      { name: '1-2', plan_id: 'g1', progress: [[false, false]] },
      { name: '2-1', plan_id: 'g2', progress: [[true, true, false, false]] },
    ],
    plans: [
      { id: 'g1', name: '1학년 과학', lessons: [{ name: '1차시', items: [{ text: 'A' }, { text: 'B' }] }] },
      { id: 'g2', name: '2학년 과학', lessons: [{ name: '1차시', items: [{ text: 'C' }, { text: 'D' }, { text: 'E' }, { text: 'F' }] }] },
    ],
  });
}

test('처음 실행 기본값: 1~6반, 학년 1개(이름 1학년, 1차시에 활동 3개), 살짝 둥둥, 100%, 진도율 표시', () => {
  const d = D.freshData();
  assert.deepEqual(d.classes.map((c) => c.name), ['1반', '2반', '3반', '4반', '5반', '6반']);
  assert.equal(d.plans.length, 1);
  assert.equal(d.plans[0].name, '1학년');
  assert.deepEqual(d.plans[0].lessons[0].items.map((i) => i.text), ['여기에 활동을 적어 주세요', '⋯ 버튼으로 수정해 보세요', '다 끝나면 체크해 보세요']);
  assert.ok(d.classes.every((c) => c.plan_id === 'p1' && c.custom_image === null && c.memo === '' && c.progress[0].length === 3));
  assert.equal(d.view_plan, 'all');
  assert.equal(d.float_motion, true);
  assert.equal(d.character_scale, 100);
  assert.equal(d.show_progress_labels, true);
});

test('옛 형식(계획 하나)을 읽으면 계획 1개짜리 새 형식으로 바뀌고 진도·메모는 그대로', () => {
  assert.equal(D.isLegacyFormat(OLD_FORMAT), true);
  const d = D.normalizeData(OLD_FORMAT);
  assert.equal('plan' in d, false);
  assert.equal(d.plans.length, 1);
  assert.equal(d.plans[0].id, 'p1');
  assert.deepEqual(d.plans[0].lessons.map((l) => l.name), ['1차시', '2차시']);
  assert.equal(d.classes[0].plan_id, 'p1');
  assert.deepEqual(d.classes[0].progress, [[true, false, false], []]);
  assert.equal(d.classes[0].memo, '이 반 메모');
  assert.equal(d.classes[0].custom_image, OLD_FORMAT.classes[0].custom_image);
  assert.deepEqual(d.lesson, { 0: 1 });
  assert.equal(D.completion(d, 0), 33);
  const file = D.toFileData(d);
  assert.equal(D.isLegacyFormat(file), false);
  assert.ok(!JSON.stringify(file).includes('_uid'));
});

test('새 형식은 저장 모양으로 바꿨다가 다시 읽어도 같다', () => {
  const file = D.toFileData(twoPlans());
  assert.deepEqual(D.toFileData(D.normalizeData(file)), file);
});

test('모르는 항목과 옛 image 값은 지우지 않는다', () => {
  const input = { ...OLD_FORMAT, future_option: 'x', classes: [{ ...OLD_FORMAT.classes[0], image: 3, extra: 1 }] };
  const out = D.toFileData(D.normalizeData(input));
  assert.equal(out.future_option, 'x');
  assert.equal(out.classes[0].image, 3);
  assert.equal(out.classes[0].extra, 1);
});

test('입력 객체는 바꾸지 않는다', () => {
  const copy = JSON.parse(JSON.stringify(OLD_FORMAT));
  D.normalizeData(copy);
  assert.deepEqual(copy, OLD_FORMAT);
});

test('progress 크기가 그 반 계획과 다르면 부족한 칸은 false, 남는 칸은 버린다', () => {
  const input = JSON.parse(JSON.stringify(OLD_FORMAT));
  input.classes[0].progress = [[true, true, true, true, true]];
  assert.deepEqual(D.normalizeData(input).classes[0].progress, [[true, true, true], []]);
  input.classes[0].progress = 'garbage';
  assert.deepEqual(D.normalizeData(input).classes[0].progress, [[false, false, false], []]);
  const d = twoPlans();
  assert.deepEqual(d.classes[2].progress, [[true, true, false, false]], '2학년 반은 2학년 계획 크기');
});

test('빠진 값 채우기, 이상한 값 고치기', () => {
  const d = D.normalizeData({ classes: [{}, { name: 7, memo: null }], plan: [{ items: ['문자열 활동'] }], character_scale: 999, lesson: [] });
  assert.equal(d.classes[0].name, '1반');
  assert.equal(d.classes[1].name, '7');
  assert.equal(d.classes[1].memo, '');
  assert.equal(d.classes[1].image, 1);
  assert.equal(d.plans[0].lessons[0].name, '차시');
  assert.equal(d.plans[0].lessons[0].items[0].text, '문자열 활동');
  assert.equal(d.character_scale, 150);
  assert.deepEqual(d.lesson, {});
  assert.equal(D.normalizeData({ classes: [{}], character_scale: 'x' }).character_scale, 100);
  assert.equal(D.normalizeData({ classes: [{}], character_scale: 10 }).character_scale, 50);
});

test('새 형식에서 이상한 값: 없는 계획을 가리키는 반은 첫 계획으로, 겹치는 id는 새로, 보던 계획 확인', () => {
  const d = D.normalizeData({
    classes: [{ plan_id: 'nope' }, { plan_id: 'a' }],
    plans: [{ id: 'a', name: '가', lessons: [] }, { id: 'a', name: '', lessons: [{ name: 'x', items: [] }] }],
    view_plan: 'zzz',
  });
  assert.equal(d.classes[0].plan_id, 'a');
  assert.equal(d.plans[0].id, 'a');
  assert.notEqual(d.plans[1].id, 'a');
  assert.equal(d.plans[1].name, '2학년');
  assert.deepEqual(d.plans[0].lessons.map((l) => l.name), ['1차시'], '빈 계획에는 1차시를 하나 만듦');
  assert.equal(d.view_plan, 'all');
  assert.equal(D.normalizeData({ classes: [{}], plans: [] }).plans.length, 1);
});

test('plan이 빈 목록이면 1차시 하나를 만든다', () => {
  const d = D.normalizeData({ classes: [{}], plan: [] });
  assert.equal(d.plans[0].lessons.length, 1);
  assert.equal(d.plans[0].lessons[0].name, '1차시');
});

test('구조가 망가진 파일은 오류로 알린다', () => {
  for (const bad of [null, [], {}, { classes: [] }, { classes: [1] }, { classes: [{}], plan: {} }, { classes: [{}], plan: [1] },
    { classes: [{}], plan: [{ items: {} }] }, { classes: [{}], plan: [{ items: [5] }] },
    { classes: [{}], plans: {} }, { classes: [{}], plans: [1] }, { classes: [{}], plans: [{ lessons: {} }] }]) {
    assert.throws(() => D.normalizeData(bad), D.DataFormatError, JSON.stringify(bad));
  }
});

test('아주 옛날 형식(반마다 lessons)을 공통 계획으로 바꾸고 체크는 활동 이름으로 맞춘다', () => {
  const legacy = {
    classes: [
      { name: '1반', lessons: [{ name: '도입', items: [{ text: 'A', done: true }, { text: 'B', done: false }] }] },
      { name: '2반', lessons: [{ name: '도입', items: [{ text: 'B', done: true }, { text: 'C', done: true }] }, { name: '전개', items: [{ text: 'D', done: true }] }] },
    ],
  };
  const d = D.normalizeData(legacy);
  assert.deepEqual(d.plans[0].lessons.map((l) => [l.name, l.items.map((i) => i.text)]), [['도입', ['A', 'B', 'C']], ['전개', ['D']]]);
  assert.deepEqual(d.classes[0].progress, [[true, false, false], [false]]);
  assert.deepEqual(d.classes[1].progress, [[false, true, true], [true]]);
  assert.equal('lessons' in d.classes[0], false);
});

test('진도율은 그 반이 따라가는 계획 기준, 활동이 없으면 0%', () => {
  const d = D.normalizeData(OLD_FORMAT);
  assert.equal(D.completion(d, 0), 33);
  d.classes[0].progress = [[true, true, false], []];
  assert.equal(D.completion(d, 0), 67);
  const empty = D.normalizeData({ classes: [{}], plan: [{ name: '1차시', items: [] }] });
  assert.equal(D.completion(empty, 0), 0);
  assert.deepEqual(D.lessonCompletion(d, 0, 0), { done: 2, total: 3, percent: 67 });
  assert.deepEqual(D.lessonCompletion(d, 0, 1), { done: 0, total: 0, percent: 0 });
  const p = twoPlans();
  assert.equal(D.completion(p, 0), 50, '1학년: 2개 중 1개');
  assert.equal(D.completion(p, 2), 50, '2학년: 4개 중 2개');
  assert.equal(D.planOf(p, 2).name, '2학년 과학');
});

test('요약: 반, 계획, 차시, 활동, 체크 수', () => {
  assert.deepEqual(D.summarize(twoPlans()), { classes: 3, plans: 2, lessons: 2, activities: 6, checks: 3 });
});

test('계획 색: 1번 살구, 2번 민트, 3번 노랑', () => {
  const p = twoPlans();
  assert.equal(D.planColor(p, 'g1'), '#FF8B6B');
  assert.equal(D.planColor(p, 'g2'), '#2BB096');
  assert.equal(D.PLAN_COLORS[2], '#F5BE1E');
  assert.equal(D.newPlanId(p.plans), 'p1');
});

test('반 늘리기: 기존 반 번호 다음 숫자로 이름, 계획은 마지막 반과 같게', () => {
  let d = D.freshData();
  d.classes[5].name = '9반';
  d = D.resizeClasses(d, 8);
  assert.deepEqual(d.classes.slice(6).map((c) => c.name), ['10반', '11반']);
  assert.deepEqual(d.classes[7].progress, [[false, false, false]]);
  const p = D.resizeClasses(twoPlans(), 4);
  assert.equal(p.classes[3].plan_id, 'g2');
  assert.deepEqual(p.classes[3].progress, [[false, false, false, false]]);
});

test('반 줄이기: 뒤쪽 반과 그 반의 마지막 차시 기록이 사라진다, 1~20 범위', () => {
  let d = D.freshData();
  d.lesson = { 0: 0, 5: 0 };
  d = D.resizeClasses(d, 3);
  assert.equal(d.classes.length, 3);
  assert.deepEqual(d.lesson, { 0: 0 });
  assert.equal(D.resizeClasses(d, 0).classes.length, 1);
  assert.equal(D.resizeClasses(d, 99).classes.length, 20);
});

test('트랙 위치: 진도 순서 유지, 같은 진도는 필요한 만큼만 띄움', () => {
  const pos = D.raceLayout([50, 50, 0, 100], 0, 1000, 72);
  assert.equal(pos[2], 0);
  assert.equal(pos[3], 1000);
  assert.equal(pos[0], 500);
  assert.equal(pos[1], 572);
  const values = [10, 80, 80, 80, 81, 100, 0];
  const p = D.raceLayout(values, 20, 600);
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b] || a - b);
  for (let i = 1; i < order.length; i++) assert.ok(p[order[i]] >= p[order[i - 1]], '순서 유지');
  assert.ok(p.every((x) => x >= 20 && x <= 620), '트랙 밖으로 나가지 않음');
});

test('트랙 위치: 끝에 몰려도 겹치지 않게 앞으로 밀어 줌', () => {
  assert.deepEqual(D.raceLayout([100, 100, 100], 0, 1000, 72), [856, 928, 1000]);
  assert.deepEqual(D.raceLayout([], 0, 100), []);
  assert.deepEqual(D.raceLayout([40], 0, 100), [40]);
});
