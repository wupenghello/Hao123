import type { Bookmark, Category } from '@/types'

export const defaultCategories: Category[] = [
  { id: 'cat-1', name: '常用', icon: 'mdi:star', order: 0 },
  { id: 'cat-2', name: '工作', icon: 'mdi:briefcase', order: 1 },
  { id: 'cat-3', name: '学习', icon: 'mdi:school', order: 2 },
  { id: 'cat-4', name: '社交', icon: 'mdi:account-group', order: 3 },
  { id: 'cat-5', name: '影音', icon: 'mdi:play-circle', order: 4 },
  { id: 'cat-6', name: '工具', icon: 'mdi:wrench', order: 5 },
]

export const defaultBookmarks: Bookmark[] = [
  // 常用
  { id: 'bm-1', name: 'Google', url: 'https://www.google.com', description: '全球最大搜索引擎', categoryId: 'cat-1', order: 0, createdAt: Date.now() },
  { id: 'bm-2', name: 'GitHub', url: 'https://github.com', description: '全球最大代码托管平台', categoryId: 'cat-1', order: 1, createdAt: Date.now() },
  { id: 'bm-3', name: 'YouTube', url: 'https://www.youtube.com', description: '全球最大视频平台', categoryId: 'cat-1', order: 2, createdAt: Date.now() },
  { id: 'bm-4', name: 'Wikipedia', url: 'https://www.wikipedia.org', description: '维基百科', categoryId: 'cat-1', order: 3, createdAt: Date.now() },
  { id: 'bm-5', name: 'Reddit', url: 'https://www.reddit.com', description: '全球最大社区', categoryId: 'cat-1', order: 4, createdAt: Date.now() },

  // 工作
  { id: 'bm-6', name: '飞书', url: 'https://www.feishu.cn', description: '字节跳动办公协作', categoryId: 'cat-2', order: 0, createdAt: Date.now() },
  { id: 'bm-7', name: 'Notion', url: 'https://www.notion.so', description: '笔记与项目管理', categoryId: 'cat-2', order: 1, createdAt: Date.now() },
  { id: 'bm-8', name: 'Figma', url: 'https://www.figma.com', description: '在线设计工具', categoryId: 'cat-2', order: 2, createdAt: Date.now() },
  { id: 'bm-9', name: 'Slack', url: 'https://slack.com', description: '团队即时通讯', categoryId: 'cat-2', order: 3, createdAt: Date.now() },

  // 学习
  { id: 'bm-10', name: 'MDN', url: 'https://developer.mozilla.org', description: 'Web 开发文档', categoryId: 'cat-3', order: 0, createdAt: Date.now() },
  { id: 'bm-11', name: 'Stack Overflow', url: 'https://stackoverflow.com', description: '开发者问答社区', categoryId: 'cat-3', order: 1, createdAt: Date.now() },
  { id: 'bm-12', name: 'LeetCode', url: 'https://leetcode.cn', description: '算法刷题平台', categoryId: 'cat-3', order: 2, createdAt: Date.now() },
  { id: 'bm-13', name: 'Coursera', url: 'https://www.coursera.org', description: '在线课程平台', categoryId: 'cat-3', order: 3, createdAt: Date.now() },
  { id: 'bm-23', name: '菜鸟教程', url: 'https://www.runoob.com', description: '编程语言基础教程', categoryId: 'cat-3', order: 4, createdAt: Date.now() },

  // 社交
  { id: 'bm-14', name: '微博', url: 'https://weibo.com', description: '中国社交媒体', categoryId: 'cat-4', order: 0, createdAt: Date.now() },
  { id: 'bm-15', name: 'Twitter / X', url: 'https://x.com', description: '全球社交媒体', categoryId: 'cat-4', order: 1, createdAt: Date.now() },
  { id: 'bm-16', name: '知乎', url: 'https://www.zhihu.com', description: '知识问答社区', categoryId: 'cat-4', order: 2, createdAt: Date.now() },
  { id: 'bm-24', name: 'Facebook', url: 'https://www.facebook.com', description: '全球社交网络', categoryId: 'cat-4', order: 3, createdAt: Date.now() },

  // 影音
  { id: 'bm-17', name: 'Bilibili', url: 'https://www.bilibili.com', description: 'B 站视频社区', categoryId: 'cat-5', order: 0, createdAt: Date.now() },
  { id: 'bm-18', name: 'Netflix', url: 'https://www.netflix.com', description: '流媒体平台', categoryId: 'cat-5', order: 1, createdAt: Date.now() },
  { id: 'bm-19', name: 'Spotify', url: 'https://www.spotify.com', description: '音乐流媒体', categoryId: 'cat-5', order: 2, createdAt: Date.now() },
  { id: 'bm-25', name: '抖音', url: 'https://www.douyin.com', description: '短视频平台', categoryId: 'cat-5', order: 3, createdAt: Date.now() },

  // 工具
  { id: 'bm-20', name: 'DeepL', url: 'https://www.deepl.com', description: 'AI 翻译工具', categoryId: 'cat-6', order: 0, createdAt: Date.now() },
  { id: 'bm-21', name: 'Can I Use', url: 'https://caniuse.com', description: '浏览器兼容性查询', categoryId: 'cat-6', order: 1, createdAt: Date.now() },
  { id: 'bm-22', name: 'TinyPNG', url: 'https://tinypng.com', description: '图片压缩工具', categoryId: 'cat-6', order: 2, createdAt: Date.now() },
]
