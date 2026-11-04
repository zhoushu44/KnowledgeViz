import { closeTruncatedJson } from "../src/lib/learning.ts";

const cases = [
  '{"goals":["a","b"],"sections":[{"title":"t1","body":"hello"}]}',
  '{"goals":["a","b"],"sections":[{"title":"t1","body":"hell',       // 截断在字符串中
  '{"goals":["a"],"sections":[{"title":"t1","body":"hello"},{"title":"t2","body":"wor',  // 截断在第二项字符串
  '```json\n{"goals":["a"],"sections":[{"title":"t","body":"x"',      // 缺右侧
];
for (const c of cases) {
  const raw = c.includes('```') ? c.replace(/```json\n/, '').replace(/^.*?(\{)/, '$1') : c;
  const r = closeTruncatedJson(raw);
  console.log('IN :', raw.length > 70 ? raw.slice(0, 70) + '…' : raw);
  console.log('OUT:', r);
  try { console.log(' parse OK:', JSON.stringify(JSON.parse(r)).slice(0, 120)); } catch (e) { console.log(' parse FAIL'); }
  console.log('');
}
