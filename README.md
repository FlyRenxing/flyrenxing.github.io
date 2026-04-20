# Blog Engine

Astro 6.0 构建系统，包含 AI 增强层。

## 目录结构

```
src/
├── content/
│   └── config.ts      # Astro 内容集合配置
├── components/
│   └── Search.astro   # Orama 搜索组件
├── layouts/
│   └── Base.astro     # 基础布局
└── pages/
    ├── index.astro    # 首页
    └── blog/
        └── [...slug].astro  # 博客文章页
scripts/
└── pre-build.js       # AI 增强脚本
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 配置

### DeepSeek API

1. 获取 DeepSeek API Key: https://platform.deepseek.com/
2. 在 GitHub Repo 设置中添加 secrets:
   - `DEEPSEEK_API_KEY`: 你的 API 密钥

### 双仓联动

在 Content Repo 的 `.github/workflows/sync.yml` 中修改：

```yaml
repository: YOUR_USERNAME/engine-repo
```

## 工作流程

1. **Content Repo**: 推送 MDX 文件
2. **GitHub Actions**: 触发 `repository_dispatch` 事件
3. **Engine Repo**: 接收事件，运行 AI 预处理，构建部署

## 搜索功能

使用 Orama 进行客户端全文检索，支持语义搜索。

## 图片优化

Astro 内置图片优化，支持：
- 多种格式: avif, webp, jpg
- 响应式图片
- 像素密度生成