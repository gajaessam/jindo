'use strict';
// "수업 계획 설정" 창에서 고친 계획들을 적용할 때, 그동안 진도창에서 한 체크를 잃지 않도록 합칩니다.
// 활동마다 붙은 꼬리표(_uid)로 체크를 따라가므로 순서를 바꾸거나 다른 차시로 옮겨도 체크가 따라갑니다.

const { cloneData, attachUids, planById, MAX_PLANS, VIEW_ALL, DEFAULT_PLAN_NAME } = require('./data');

// 계획들의 이름·차시·활동·순서만 뽑은 "모양"
function plansShape(plans) {
  return JSON.stringify(plans.map((p) => [p.id, p.name,
    p.lessons.map((lesson) => [lesson._uid, lesson.name, lesson.items.map((item) => [item._uid, item.text])])]));
}

// 설정 창을 연 뒤 진도창에서 계획 자체(차시·활동 추가/삭제/이름/순서)가 바뀌었는지
function planChangedSince(openedPlans, livePlans) {
  return plansShape(openedPlans) !== plansShape(livePlans);
}

// data에 editedPlans를 적용한 새 data를 돌려줍니다.
// - reassign: { 지운계획id: 옮겨갈계획id } — 지운 계획을 따라가던 반을 옮길 곳
// - 체크는 지금(live) 상태에서 가져옵니다. (설정 창을 연 뒤 한 체크도 그대로)
// - 새로 만든 활동은 체크 안 됨, 지운 활동의 체크는 사라짐
// - 다른 계획으로 옮겨진 반은 체크가 처음부터 시작됨
// - 반마다 마지막으로 보던 차시도 같은 차시를 따라갑니다.
function applyEditedPlans(data, editedPlans, reassign = {}) {
  const out = cloneData(data);
  const plans = cloneData(editedPlans);
  if (!plans.length) throw new Error('학년은 하나 이상 있어야 해요.');
  for (const plan of plans) {
    if (!plan.lessons.length) throw new Error('차시는 하나 이상 있어야 해요.');
    attachUids(plan.lessons);
  }
  const has = (id) => plans.some((p) => p.id === id);

  const lessonSel = {};
  out.classes.forEach((cls, ci) => {
    const oldPlan = planById(data, data.classes[ci].plan_id);
    let newId = cls.plan_id;
    if (!has(newId)) newId = has(reassign[newId]) ? reassign[newId] : plans[0].id;
    const newPlan = plans.find((p) => p.id === newId);

    const done = new Map();
    oldPlan.lessons.forEach((lesson, li) => {
      lesson.items.forEach((item, ii) => done.set(item._uid, Boolean(cls.progress[li] && cls.progress[li][ii])));
    });
    cls.plan_id = newId;
    cls.progress = newPlan.lessons.map((lesson) => lesson.items.map((item) => done.get(item._uid) || false));

    const key = String(ci);
    if (key in (data.lesson || {})) {
      const oldLesson = oldPlan.lessons[Number(data.lesson[key])];
      let idx = oldLesson ? newPlan.lessons.findIndex((l) => l._uid === oldLesson._uid) : -1;
      if (idx < 0) idx = newId === oldPlan.id ? Math.max(0, Math.min(newPlan.lessons.length - 1, Number(data.lesson[key]) || 0)) : 0;
      lessonSel[key] = idx;
    }
  });
  out.plans = plans;
  out.lesson = lessonSel;
  if (out.view_plan !== VIEW_ALL && !has(out.view_plan)) out.view_plan = VIEW_ALL;
  return out;
}

// 반마다 학년(계획) 정하기. classPlans[i] = i번째 반이 따라갈 계획 id.
// 학년이 바뀐 반은 새 학년 기준으로 체크가 처음부터 시작되고 보던 차시도 처음으로.
// 결과: { data, losing: [체크가 지워지는 반 이름] } — data는 새로 만든 복사본
function assignClasses(data, classPlans) {
  const out = cloneData(data);
  const losing = [];
  if (!Array.isArray(classPlans) || classPlans.length !== out.classes.length) return { data: out, losing };
  out.classes.forEach((cls, i) => {
    const want = classPlans[i];
    if (!want || want === cls.plan_id || !out.plans.some((p) => p.id === want)) return;
    if (cls.progress.some((marks) => marks.some(Boolean))) losing.push(cls.name);
    cls.plan_id = want;
    cls.progress = planById(out, want).lessons.map((lesson) => lesson.items.map(() => false));
    delete out.lesson[String(i)];
  });
  return { data: out, losing };
}

function cleanText(value, fallback) {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

// 설정 창에서 받은 계획들 정리: 빈 이름은 기본값으로, 계획·차시는 하나 이상, id는 겹치지 않게
function cleanPlans(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('학년은 하나 이상 있어야 해요.');
  if (input.length > MAX_PLANS) throw new Error(`학년은 ${MAX_PLANS}개까지 만들 수 있어요.`);
  const used = new Set();
  return input.map((plan, pi) => {
    let id = plan && typeof plan.id === 'string' && /^[\w-]{1,40}$/.test(plan.id) ? plan.id : '';
    if (!id || used.has(id)) {
      let n = pi + 1;
      while (used.has(`p${n}`) || input.some((p, j) => j !== pi && p && p.id === `p${n}`)) n++;
      id = `p${n}`;
    }
    used.add(id);
    const name = cleanText(plan && plan.name, `${pi + 1}학년`);
    let lessons = (Array.isArray(plan && plan.lessons) ? plan.lessons : []).map((lesson, li) => {
      const items = (Array.isArray(lesson && lesson.items) ? lesson.items : []).map((item) => {
        const text = cleanText(item && item.text, '활동');
        return item && item._uid ? { text, _uid: String(item._uid) } : { text };
      });
      const lname = cleanText(lesson && lesson.name, `${li + 1}차시`);
      return lesson && lesson._uid ? { name: lname, items, _uid: String(lesson._uid) } : { name: lname, items };
    });
    if (!lessons.length) lessons = [{ name: '1차시', items: [] }];
    return { id, name: name.slice(0, 40), lessons };
  });
}

module.exports = { planChangedSince, applyEditedPlans, assignClasses, cleanPlans };
