'use strict';
// 진도창에서 하는 일들. 넘겨받은 data를 그 자리에서 바꿉니다. (main이 저장·화면 갱신을 맡음)
// 차시·활동은 같은 계획을 따라가는 반들이 함께 쓰고, 체크와 메모만 반마다 따로입니다.

const { newUid, planById, planOf } = require('./data');

function clampLesson(plan, idx) {
  const n = Number.parseInt(idx, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(plan.lessons.length - 1, n));
}

function currentLesson(data, classIdx) {
  return clampLesson(planOf(data, classIdx), data.lesson[String(classIdx)] ?? 0);
}

function setLesson(data, classIdx, lessonIdx) {
  data.lesson[String(classIdx)] = clampLesson(planOf(data, classIdx), lessonIdx);
  return data.lesson[String(classIdx)];
}

function cleanText(text, fallback) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

// 이 계획을 따라가는 반들
function classesOf(data, planId) {
  return data.classes.filter((cls) => cls.plan_id === planId);
}

function toggleItem(data, classIdx, lessonIdx, itemIdx, value) {
  const marks = data.classes[classIdx].progress[lessonIdx];
  if (!marks || itemIdx < 0 || itemIdx >= marks.length) throw new Error('없는 활동이에요.');
  marks[itemIdx] = value === undefined ? !marks[itemIdx] : Boolean(value);
  return marks[itemIdx];
}

function addItem(data, planId, lessonIdx, text) {
  const lesson = planById(data, planId).lessons[lessonIdx];
  lesson.items.push({ text: cleanText(text, '활동'), _uid: newUid() });
  for (const cls of classesOf(data, planId)) cls.progress[lessonIdx].push(false);
  return lesson.items.length - 1;
}

function editItem(data, planId, lessonIdx, itemIdx, text) {
  const item = planById(data, planId).lessons[lessonIdx].items[itemIdx];
  item.text = cleanText(text, item.text);
}

function moveItem(data, planId, lessonIdx, itemIdx, delta) {
  const items = planById(data, planId).lessons[lessonIdx].items;
  const to = itemIdx + delta;
  if (to < 0 || to >= items.length) return itemIdx;
  const swap = (arr) => { [arr[itemIdx], arr[to]] = [arr[to], arr[itemIdx]]; };
  swap(items);
  for (const cls of classesOf(data, planId)) swap(cls.progress[lessonIdx]);
  return to;
}

function deleteItem(data, planId, lessonIdx, itemIdx) {
  planById(data, planId).lessons[lessonIdx].items.splice(itemIdx, 1);
  for (const cls of classesOf(data, planId)) cls.progress[lessonIdx].splice(itemIdx, 1);
}

function addLesson(data, planId, name) {
  const plan = planById(data, planId);
  plan.lessons.push({ name: cleanText(name, `${plan.lessons.length + 1}차시`), items: [], _uid: newUid() });
  for (const cls of classesOf(data, planId)) cls.progress.push([]);
  return plan.lessons.length - 1;
}

function renameLesson(data, planId, lessonIdx, name) {
  const lesson = planById(data, planId).lessons[lessonIdx];
  lesson.name = cleanText(name, lesson.name);
}

// 차시가 1개뿐이면 지울 수 없음. 이 계획을 따라가는 반의 "보던 차시" 번호도 맞춰 줍니다.
function deleteLesson(data, planId, lessonIdx) {
  const plan = planById(data, planId);
  if (plan.lessons.length <= 1) throw new Error('차시가 1개뿐이라 지울 수 없어요.');
  plan.lessons.splice(lessonIdx, 1);
  data.classes.forEach((cls, ci) => {
    if (cls.plan_id !== planId) return;
    cls.progress.splice(lessonIdx, 1);
    const key = String(ci);
    if (!(key in data.lesson)) return;
    const v = Number(data.lesson[key]);
    if (v > lessonIdx) data.lesson[key] = v - 1;
    else if (v === lessonIdx) data.lesson[key] = Math.min(lessonIdx, plan.lessons.length - 1);
  });
}

function setMemo(data, classIdx, text) {
  data.classes[classIdx].memo = String(text ?? '');
}

// 계획 변경 되돌리기: snapshot(변경 직전)의 계획들로 돌아가되,
// 그 뒤에 한 체크와 메모·반 이름 등은 지금 것을 유지합니다.
function undoPlan(current, snapshot) {
  if (snapshot.classes.length !== current.classes.length) throw new Error('반 개수가 바뀌어 되돌릴 수 없어요.');
  current.classes.forEach((cls, ci) => {
    const done = new Map();
    const fill = (src) => {
      const plan = planById(src, src.classes[ci].plan_id);
      plan.lessons.forEach((lesson, li) => lesson.items.forEach((item, ii) => {
        done.set(item._uid, Boolean(src.classes[ci].progress[li] && src.classes[ci].progress[li][ii]));
      }));
    };
    fill(snapshot);
    fill(current);
    const plan = planById(snapshot, snapshot.classes[ci].plan_id);
    cls.plan_id = plan.id;
    cls.progress = plan.lessons.map((lesson) => lesson.items.map((item) => done.get(item._uid) || false));
  });
  current.plans = JSON.parse(JSON.stringify(snapshot.plans));
  current.lesson = JSON.parse(JSON.stringify(snapshot.lesson));
}

module.exports = {
  currentLesson, setLesson, toggleItem, addItem, editItem, moveItem, deleteItem,
  addLesson, renameLesson, deleteLesson, setMemo, undoPlan, classesOf,
};
