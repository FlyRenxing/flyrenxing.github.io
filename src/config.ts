// 站点配置常量
export const SITE_CONFIG = {
  siteName: 'RENXING',
} as const;

// GitHub 配置
export const GITHUB_CONFIG = {
  username: 'FlyRenxing',
  contentRepo: {
    owner: 'FlyRenxing',
    repo: 'content-repo',
    branch: 'main',
    path: 'content/posts',  // 文章存放路径
  },
} as const;