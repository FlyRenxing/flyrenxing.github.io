/**
 * Pre-build Script: AI 增强层
 *
 * 功能：
 * 1. 读取 content/posts/ 目录的 MDX 文件
 * 2. 调用 DeepSeek API 生成摘要和 SEO TDK（需要配置 API Key）
 * 3. 使用 Orama 构建搜索索引
 *
 * 使用方法：
 *   node scripts/pre-build.js
 *
 * 环境变量：
 *   DEEPSEEK_API_KEY - DeepSeek API 密钥
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { create, insert, save } from '@orama/orama';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// 配置
const CONTENT_DIR = path.join(ROOT_DIR, 'content', 'posts');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SEARCH_INDEX_PATH = path.join(PUBLIC_DIR, 'search-index.json');

// Content Repo 路径（本地开发时）
const CONTENT_REPO_PATH = path.resolve(ROOT_DIR, '..', 'content-repo', 'content');

/**
 * 从 content-repo 同步内容（本地开发）
 */
function syncFromContentRepo() {
  const postsSrc = path.join(CONTENT_REPO_PATH, 'posts');
  const imagesSrc = path.join(CONTENT_REPO_PATH, 'images');

  // 同步文章
  if (fs.existsSync(postsSrc)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
    const files = fs.readdirSync(postsSrc).filter(f => f.endsWith('.mdx'));
    for (const file of files) {
      const src = path.join(postsSrc, file);
      const dest = path.join(CONTENT_DIR, file);
      if (!fs.existsSync(dest) || fs.statSync(src).mtime > fs.statSync(dest).mtime) {
        fs.copyFileSync(src, dest);
        console.log(`📄 同步文章: ${file}`);
      }
    }
  }

  // 同步图片
  if (fs.existsSync(imagesSrc)) {
    const imagesDest = path.join(PUBLIC_DIR, 'images');
    fs.mkdirSync(imagesDest, { recursive: true });
    const files = fs.readdirSync(imagesSrc);
    for (const file of files) {
      const src = path.join(imagesSrc, file);
      const dest = path.join(imagesDest, file);
      if (!fs.existsSync(dest) || fs.statSync(src).mtime > fs.statSync(dest).mtime) {
        fs.copyFileSync(src, dest);
        console.log(`🖼️  同步图片: ${file}`);
      }
    }
  }
}

// 增强的分词器 - 支持中英文，支持前缀匹配
function tokenize(text) {
  if (!text) return [];
  const tokens = new Set();
  const lowerText = text.toLowerCase();
  const chineseRegex = /[\u4e00-\u9fff]/;

  // 分割文本为中英文片段
  let current = '';
  let isChinese = false;

  for (const char of lowerText) {
    const charIsChinese = chineseRegex.test(char);
    if (charIsChinese === isChinese && char !== ' ' && char !== '\n' && !/[\p{P}]/u.test(char)) {
      current += char;
    } else {
      if (current) {
        processSegment(current, isChinese, tokens);
      }
      current = charIsChinese ? char : '';
      isChinese = charIsChinese;
    }
  }
  if (current) {
    processSegment(current, isChinese, tokens);
  }

  return Array.from(tokens);
}

function processSegment(segment, isChinese, tokens) {
  if (isChinese) {
    // 中文：生成单字、双字、三字 n-gram
    const chars = Array.from(segment);
    // 单字
    for (const char of chars) tokens.add(char);
    // 双字组合
    for (let i = 0; i < chars.length - 1; i++) tokens.add(chars[i] + chars[i + 1]);
    // 三字组合
    for (let i = 0; i < chars.length - 2; i++) tokens.add(chars[i] + chars[i + 1] + chars[i + 2]);
    // 完整词
    if (segment.length > 1) tokens.add(segment);
  } else {
    // 英文：生成前缀 n-gram 支持前缀匹配
    const word = segment.toLowerCase();
    tokens.add(word); // 完整词
    // 生成前缀（至少2个字符）
    for (let i = 2; i < word.length; i++) {
      tokens.add(word.slice(0, i));
    }
  }
}

// Orama 搜索索引配置
const searchSchema = {
  id: 'string',
  title: 'string',
  description: 'string',
  tags: 'string[]',
  slug: 'string',
  summary: 'string',
  content: 'string',
};

/**
 * 解析 MDX 文件的 frontmatter
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, content };

  const frontmatter = match[1];
  const data = {};

  frontmatter.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length) {
      let value = valueParts.join(':').trim();
      // 移除引号
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      // 解析数组
      if (value.startsWith('[') && value.endsWith(']')) {
        data[key.trim()] = value.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
      } else {
        data[key.trim()] = value;
      }
    }
  });

  return { data, content: content.slice(match[0].length) };
}

/**
 * 调用智谱 API 生成摘要
 * 注意：需要配置 ZHIPU_API_KEY 环境变量
 */
async function generateSummaryWithAI(title, content) {
  const apiKey = process.env.ZHIPU_API_KEY;

  if (!apiKey) {
    console.log('⚠️  ZHIPU_API_KEY 未配置，跳过 AI 摘要生成');
    return null;
  }

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'GLM-4.7-Flash',
        messages: [
          {
            role: 'system',
            content: '你是一个博客摘要生成助手。请根据文章标题和内容，生成一段简洁的摘要（50-100字），用于 SEO 和文章预览。'
          },
          {
            role: 'user',
            content: `标题：${title}\n\n内容：${content.slice(0, 2000)}`
          }
        ],
        max_tokens: 8192,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${JSON.stringify(data).slice(0, 200)}`);
    }
    if (!data.choices || !data.choices[0]) {
      console.log(`❌ API 返回格式异常: ${JSON.stringify(data).slice(0, 300)}`);
      return null;
    }
    const msg = data.choices[0].message;
    // 推理模型：content 为最终回答，reasoning_content 为思考过程
    // 如果 content 为空，说明推理未完成，增大 token 或换非推理模型
    if (msg?.content) {
      return msg.content.trim();
    }
    console.log(`❌ API content 为空 (finish_reason=${data.choices[0].finish_reason})，推理未完成或模型返回异常`);
    return null;
  } catch (error) {
    console.log(`❌ AI 摘要生成失败: ${error.message}`);
    return null;
  }
}

/**
 * 构建搜索索引
 */
async function buildSearchIndex(posts) {
  console.log('🔍 构建搜索索引...');

  const db = await create({
    schema: searchSchema,
    components: {
      tokenizer: {
        // 使用增强分词器支持中英文前缀匹配
        tokenize,
      },
    },
  });

  for (const post of posts) {
    await insert(db, {
      id: post.slug,
      title: post.title,
      description: post.description,
      tags: post.tags || [],
      slug: post.slug,
      summary: post.summary || '',
      content: post.content.slice(0, 2000), // 增加到2000字符用于搜索
    });
  }

  // 保存索引
  const indexData = await save(db);
  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(indexData, null, 2));

  console.log(`✅ 搜索索引已更新: ${posts.length} 篇文章`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始 AI 预处理...\n');

  // 从 content-repo 同步内容（本地开发）
  if (fs.existsSync(CONTENT_REPO_PATH)) {
    console.log('📁 从 content-repo 同步内容...');
    syncFromContentRepo();
    console.log('');
  }

  // 检查 content 目录
  if (!fs.existsSync(CONTENT_DIR)) {
    console.log('⚠️  content/posts/ 目录不存在，跳过 AI 预处理');
    return;
  }

  // 读取所有 MDX 文件
  const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.mdx'));

  if (files.length === 0) {
    console.log('⚠️  没有找到 MDX 文件');
    return;
  }

  console.log(`📄 找到 ${files.length} 篇文章\n`);

  const posts = [];

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = parseFrontmatter(content);

    const slug = file.replace('.mdx', '');
    const title = data.title || slug;
    const description = data.description || '';
    const tags = data.tags || [];

    console.log(`📝 处理: ${title}`);

    // 自动注入 updatedDate：用 git log 获取文件最后提交时间
    if (!data.updatedDate) {
      try {
        // CI 环境：content-repo checkout 到 content-repo/ 子目录
        // 本地开发：content-repo 在 ../content-repo/
        const contentRepoDir = path.join(ROOT_DIR, 'content-repo');
        const gitCwd = fs.existsSync(path.join(contentRepoDir, '.git')) ? contentRepoDir : ROOT_DIR;
        const gitPath = gitCwd === contentRepoDir
          ? `content/posts/${file}`
          : `content-repo/content/posts/${file}`;
        const gitDate = execSync(
          `git log -1 --format="%aI" -- ${gitPath}`,
          { encoding: 'utf-8', cwd: gitCwd }
        ).trim();
        if (gitDate) {
          const dateStr = gitDate.slice(0, 10);
          const updatedContent = content.replace(
            /^---\n/,
            `---\nupdatedDate: ${dateStr}\n`
          );
          fs.writeFileSync(filePath, updatedContent);
          data.updatedDate = gitDate;
          console.log(`   📅 注入 updatedDate: ${dateStr}`);
        }
      } catch (e) {
        // git log 失败（本地无 git）则忽略
      }
    }

    // 生成 AI 摘要
    let summary = data.summary;
    const aiSummary = await generateSummaryWithAI(title, body);
    if (aiSummary) {
      summary = aiSummary;
      console.log(`   🤖 AI 摘要: ${summary.slice(0, 50)}...`);
      // 写回 MDX frontmatter，让 Astro content collection 能读到
      let fileContent = fs.readFileSync(filePath, 'utf-8');
      fileContent = fileContent.replace(
        /^---\n/,
        `---\nsummary: "${aiSummary.replace(/"/g, '\\"').replace(/\n/g, ' ')}"\n`
      );
      fs.writeFileSync(filePath, fileContent);
    }

    posts.push({
      slug,
      title,
      description,
      tags,
      summary,
      content: body,
      aiGenerated: !!aiSummary,
    });
  }

  // 构建搜索索引
  await buildSearchIndex(posts);

  console.log('\n✨ AI 预处理完成!');
}

main().catch(console.error);