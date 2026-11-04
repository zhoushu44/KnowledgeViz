import { extractBranchNames, summarizePrompt } from '../src/lib/generate.ts';
const prompt = `# 角色
你是知识工程专家。

# 任务
为「精益创业」构建知识体系。领域描述：用最小可行产品快速验证商业假设
涵盖范围：客户开发、MVP设计、验证学习、增长引擎、商业模式、精益度量、转型决策、创业团队
目标受众：初创团队与产品负责人
应用场景：新业务立项与产品迭代

# 输出要求
xxx`;
const sum = summarizePrompt(prompt, '精益创业知识体系');
console.log('summary:', sum);
console.log('prompt branches:', extractBranchNames(prompt));
console.log('summary branches:', extractBranchNames(sum));
console.log('plain:', extractBranchNames('构建企业架构（EA）知识体系，覆盖业务架构、应用架构、数据架构、技术架构、架构治理与转型落地，面向转岗架构师与企业数字化从业者。'));
