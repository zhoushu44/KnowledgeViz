/**
 * 本地私密配置（**不要提交**，已在 .gitignore 中忽略）
 *
 * 复制本文件为 net.local.cjs 并填入真实值，联网调研功能才会工作：
 *   cp electron/net.local.example.cjs electron/net.local.cjs
 *
 * 也可以改用环境变量 KSB_NET_BASE / KSB_NET_KEY（优先级低于本文件）。
 */
module.exports = {
  base: 'https://your-gateway.example.com',
  key: 'your-gateway-key',
};
