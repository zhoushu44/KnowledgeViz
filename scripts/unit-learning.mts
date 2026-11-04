import { lintLearning, templateLearning, degenerateReason, findFiller, hasConcrete } from "../src/lib/learning.ts";

const mk = (o) => ({ id:'x', name:'营销神经学', level:'L2', branch:'b1', definition:'营销神经学在真实项目中的落地方法与常见问题。', description:'营销神经学在真实项目中的落地方法与常见问题。', difficulty:2, importance:70, centrality:50, studyMinutes:30, tags:[], dimensions:{}, prerequisites:[], ...o });

const all = new Map();
const node = mk();
all.set('x', node);

console.log('degenerate:', degenerateReason(node));
console.log('filler found:', findFiller('它是把营销神经学推进到可执行结果的关键一环，上游结论无法落地。'));
console.log('concrete(空话):', hasConcrete('它是关键一环，非常重要'));
console.log('concrete(具体):', hasConcrete('Kahneman 1993 结肠镜实验，峰值在最后 3 分钟'));

const tpl = templateLearning(node, all);
const lintT = lintLearning(node, tpl);
console.log('template score:', lintT.score, lintT.summary, 'issues:', lintT.issues.length);

const fake = {
  goals: ['能用一句话向同事解释「营销神经学」是什么、解决什么问题'],
  sections: [
    { title: '它是什么', body: '营销神经学在真实项目中的落地方法与常见问题。' },
    { title: '为什么需要它', body: '在营销神经学这条线里，它是把「营销神经学」推进到可执行结果的关键一环：没有它，上游的结论无法落地；有了它，下游节点才有可用的输入。' },
  ],
  practice: '思考一下', pitfalls: ['只记住名词'], further: [], source: 'ai',
};
const lintF = lintLearning(node, fake);
console.log('fake score:', lintF.score, lintF.summary);
lintF.issues.forEach(i => console.log('  -', i.level, i.field, i.text));

// 好内容：必须判 real
const good = {
  goals: ['能用一套四步流程对一个详情页做显著性审计，并给出可测的修改方案', '能判断某个视觉改动是否值得做 A/B'],
  sections: [
    { title: '它到底是什么', body: '前注意加工（pre-attentive processing）指视觉系统在约 200–500 毫秒内完成的并行特征提取，处理的是对比度、颜色、朝向与运动，不处理语义。Treisman 的特征整合理论（1980）把它与需要注视的串行搜索区分开，因此"用户没看见"通常不是文案问题，而是显著性不足。' },
    { title: '怎么用', body: '做法分三步：1) 把首屏截图转灰度，看还剩几个高对比区域——超过 3 个就该收敛；2) 用 5 个人做 3 秒测试，记录他们复述出的第一个元素；3) 只改一个焦点，其余降对比，跑两周 A/B 看加购率。判断阈值：3 秒复述准确率低于 60% 视为首屏失败。' },
    { title: '什么时候不适用', body: '当商品本身是搜索型刚需（用户带着明确型号进来）时，显著性优化的边际收益接近零，此时该改的是价格与库存。反例：某店铺把首屏红字全删后转化未变，因为流量 80% 来自品牌词直搜，用户根本不看首屏。' },
  ],
  practice: '取你店里一个详情页，输出一张三列表：元素 / 灰度后的对比等级 / 是否保留。20 分钟可完成，产出可直接交给设计。',
  pitfalls: ['把"全都突出"当成重点突出，结果显著性互相抵消', '只测满意度问卷而不测 3 秒复述，得到的是礼貌性回答'],
  further: ['读 Plassmann 2008 PNAS 原文，理解价格如何改写体验表征'],
  source: 'ai',
};
const lintG = lintLearning(node, good);
console.log('good score:', lintG.score, lintG.summary);
lintG.issues.forEach(i => console.log('  -', i.level, i.field, i.text));
